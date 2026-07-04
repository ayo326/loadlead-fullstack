// Staging env start/pause control plane.
//
// Runs OUTSIDE the Elastic Beanstalk env it controls (the env is the thing
// being paused), so the button on staging.loadleadapp.com can start it back up
// even while the backend is down.
//
// Pause/resume is done by driving the env's Auto Scaling group DIRECTLY
// (min/desired = 0 to pause, 1 to resume). EB's own update-environment refuses
// to hold MinSize=0 — it silently clamps back to 1 — but EB only reconciles the
// ASG during env operations, not continuously, so a direct ASG change sticks.
// Bonus: this needs only autoscaling perms, not the broad set update-environment
// would (CloudFormation/EC2/S3/...).
//
// Auth: a shared secret in the `x-toggle-secret` header (the backend login
// can't gate "start" — the backend is down when you need to start it).

import {
  ElasticBeanstalkClient,
  DescribeEnvironmentsCommand,
  DescribeEnvironmentResourcesCommand,
} from '@aws-sdk/client-elastic-beanstalk';
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  UpdateAutoScalingGroupCommand,
} from '@aws-sdk/client-auto-scaling';

const EB_ENV = process.env.EB_ENV_NAME;
const SECRET = process.env.TOGGLE_SECRET;
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const eb = new ElasticBeanstalkClient({});
const asg = new AutoScalingClient({});

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-toggle-secret',
  'content-type': 'application/json',
};
const reply = (status, body) => ({ statusCode: status, headers: cors, body: JSON.stringify(body) });

/** The EB env's Auto Scaling group name (EB names it, so look it up each call). */
async function asgName() {
  const { EnvironmentResources } = await eb.send(
    new DescribeEnvironmentResourcesCommand({ EnvironmentName: EB_ENV })
  );
  return EnvironmentResources?.AutoScalingGroups?.[0]?.Name;
}

async function currentState() {
  const { Environments = [] } = await eb.send(
    new DescribeEnvironmentsCommand({ EnvironmentNames: [EB_ENV] })
  );
  const env = Environments[0];
  if (!env) return { state: 'absent', status: 'Absent', health: 'Grey', instances: 0 };

  const name = await asgName();
  let desired = 0, running = 0;
  if (name) {
    const { AutoScalingGroups = [] } = await asg.send(
      new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [name] })
    );
    const g = AutoScalingGroups[0];
    desired = g?.DesiredCapacity ?? 0;
    running = (g?.Instances || []).filter((i) => i.LifecycleState === 'InService').length;
  }
  // EB "Updating" or a desired/running mismatch = mid-change.
  const transitioning = (env.Status && env.Status !== 'Ready') || desired !== running;
  const state = transitioning ? 'transitioning' : desired > 0 ? 'running' : 'paused';
  return { state, status: env.Status, health: env.Health, desired, instances: running };
}

async function scale(n) {
  const name = await asgName();
  if (!name) throw new Error('no Auto Scaling group found for the environment');
  await asg.send(
    new UpdateAutoScalingGroupCommand({
      AutoScalingGroupName: name,
      MinSize: n,
      MaxSize: Math.max(n, 1),
      DesiredCapacity: n,
    })
  );
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method ?? 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const headers = event.headers || {};
  const provided = headers['x-toggle-secret'] ?? headers['X-Toggle-Secret'];
  if (!SECRET || provided !== SECRET) {
    return reply(401, { error: 'unauthorized', message: 'Missing or invalid x-toggle-secret.' });
  }

  try {
    if (method === 'GET') return reply(200, await currentState());

    // POST { action: 'start' | 'stop' }. API Gateway base64-encodes bodies when
    // the content-type isn't recognized as text, so decode when flagged.
    let action = '';
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}';
      action = JSON.parse(raw || '{}').action;
    } catch { /* ignore */ }
    if (action !== 'start' && action !== 'stop') {
      return reply(400, { error: 'bad_action', message: "action must be 'start' or 'stop'." });
    }

    const now = await currentState();
    const want = action === 'start' ? 'running' : 'paused';
    if (now.state === want) return reply(200, { ...now, noop: true });
    if (now.state === 'transitioning') {
      return reply(409, { ...now, message: 'Environment is mid-change; try again shortly.' });
    }

    await scale(action === 'start' ? 1 : 0);
    return reply(202, { state: 'transitioning', action, message: action === 'start' ? 'Starting…' : 'Pausing…' });
  } catch (err) {
    console.error('toggle error', err);
    return reply(500, { error: 'toggle_failed', message: String(err?.message || err) });
  }
};
