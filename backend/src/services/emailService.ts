// The actual Resend call now routes through services/integrations/email.ts
// — every public method below (welcome, loadMatched, ...) is unchanged.
import { sendEmail, sendRawEmail } from './integrations/email';

async function send(to: string, subject: string, html: string) {
  await sendEmail(to, subject, html);
}

function base(body: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;font-family:Inter,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:#1a3a5c;padding:24px 32px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:22px;">🚛</span>
      <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">LoadLead</span>
    </div>
    <div style="padding:32px;">${body}</div>
    <div style="padding:20px 32px;background:#f4f6f9;font-size:12px;color:#888;text-align:center;">
      © ${new Date().getFullYear()} LoadLead · <a href="https://loadleadapp.com" style="color:#1a3a5c;">loadleadapp.com</a>
    </div>
  </div></body></html>`;
}

export const EmailService = {
  async welcome(to: string, role: string) {
    const roleMessages: Record<string, { headline: string; sub: string; cta: string; link: string }> = {
      DRIVER: {
        headline: "Welcome to LoadLead, Driver!",
        sub: "You're now part of the network. Complete your profile in Settings to start receiving load offers matched to your equipment and location.",
        cta: "Go to Settings",
        link: "https://loadleadapp.com/settings",
      },
      SHIPPER: {
        headline: "Welcome to LoadLead, Shipper!",
        sub: "You're ready to dispatch freight in real time. Complete your profile then post your first load to broadcast it to qualified drivers instantly.",
        cta: "Post a Load",
        link: "https://loadleadapp.com/shipper/post",
      },
      RECEIVER: {
        headline: "Welcome to LoadLead, Receiver!",
        sub: "You can now track inbound shipments and sign digital delivery receipts. Complete your facility profile in Settings to get started.",
        cta: "Complete Profile",
        link: "https://loadleadapp.com/settings",
      },
      ADMIN: {
        headline: "Welcome to LoadLead, Admin!",
        sub: "Your admin account is active. Head to the dashboard to manage drivers, shippers, and platform operations.",
        cta: "Go to Dashboard",
        link: "https://loadleadapp.com/admin",
      },
      CARRIER_ADMIN: {
        headline: "Welcome to LoadLead, Carrier!",
        sub: "Your carrier company is set up. Submit your company verification (FMCSA + KYB), then onboard your drivers to start dispatching loads.",
        cta: "Go to Carrier Dashboard",
        link: "https://loadleadapp.com/carrier",
      },
    };
    const m = roleMessages[role] ?? roleMessages.DRIVER;
    await send(to, `Welcome to LoadLead — ${m.headline}`, base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">${m.headline}</h2>
      <p style="color:#555;margin:0 0 24px;">${m.sub}</p>
      <a href="${m.link}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        ${m.cta}
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:28px;">Questions? Reply to this email or visit <a href="https://loadleadapp.com" style="color:#1a3a5c;">loadleadapp.com</a>.</p>
    `));
  },


  async loadMatched(to: string, data: { loadId: string; origin: string; destination: string; rate: number; miles: number }) {
    await send(to, '🚛 New Load Available — LoadLead', base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">New load matched to you</h2>
      <p style="color:#555;margin:0 0 24px;">A new load is waiting for your acceptance.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:14px;">Route</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${data.origin} → ${data.destination}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:14px;">Miles</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${data.miles} mi</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:14px;">Rate</td>
            <td style="padding:8px 0;font-weight:600;color:#16a34a;">$${data.rate.toFixed(2)}/mi · Est. $${(data.rate * data.miles).toFixed(0)} total</td></tr>
      </table>
      <a href="https://loadleadapp.com/driver/loads/${data.loadId}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        View &amp; Accept Load
      </a>
    `));
  },

  async offerAccepted(to: string, data: { loadId: string; driverName: string; origin: string; destination: string }) {
    await send(to, '✅ Driver Accepted Your Load — LoadLead', base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">Your load has been accepted</h2>
      <p style="color:#555;margin:0 0 24px;"><strong>${data.driverName}</strong> accepted your load from <strong>${data.origin}</strong> to <strong>${data.destination}</strong>.</p>
      <a href="https://loadleadapp.com/shipper/loads/${data.loadId}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        Track Load
      </a>
    `));
  },

  async deliveryConfirmed(to: string, data: { loadId: string; origin: string; destination: string; deliveredAt: string }) {
    await send(to, '📦 Delivery Confirmed — LoadLead', base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">Load delivered successfully</h2>
      <p style="color:#555;margin:0 0 8px;">Your shipment from <strong>${data.origin}</strong> to <strong>${data.destination}</strong> has been delivered.</p>
      <p style="color:#888;font-size:13px;margin:0 0 24px;">Delivered at: ${data.deliveredAt}</p>
      <a href="https://loadleadapp.com/shipper/loads/${data.loadId}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        View Details &amp; BOL
      </a>
    `));
  },

  async sendOrgInvitation(to: string, orgName: string, inviteUrl: string) {
    await send(to, `🏢 You've been invited to join ${orgName} on LoadLead`, base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">You're invited!</h2>
      <p style="color:#555;margin:0 0 8px;">You've been invited to join <strong>${orgName}</strong> on LoadLead.</p>
      <p style="color:#888;font-size:13px;margin:0 0 24px;">This invitation expires in 72 hours.</p>
      <a href="${inviteUrl}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        Accept Invitation
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">If you weren't expecting this, you can safely ignore it.</p>
    `));
  },

  /**
   * Beta mailing-list → application-form email. Sent when a visitor submits
   * their email on the sign-in page / beta landing to join the waitlist:
   * we thank them + hand them the beta application form (Tally) so they can
   * apply right away.
   */
  async betaFormInvite(to: string, formUrl: string) {
    await send(to, `You're on the LoadLead beta list — here's the application`, base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">Thanks for your interest in LoadLead</h2>
      <p style="color:#555;margin:0 0 8px;">You're on the founding-beta mailing list. We're admitting shippers and carriers in small, balanced waves.</p>
      <p style="color:#555;margin:0 0 24px;">Want to be considered for the current wave? Take ~3 minutes to tell us about your freight:</p>
      <a href="${formUrl}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        Apply to the beta
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">If you'd rather just stay on the list, no action needed — we'll reach out as seats open.</p>
    `));
  },

  /**
   * Platform-staff invitation. Sent when a STAFF_ADMIN invites an internal
   * team member. Mirrors sendOrgInvitation but for the internal staff
   * surface (admin.loadleadapp.com), with the role they're being granted.
   */
  async staffInvite(to: string, roleLabel: string, acceptUrl: string) {
    await send(to, `🔐 You've been invited to the LoadLead staff team`, base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">You're invited to the LoadLead team</h2>
      <p style="color:#555;margin:0 0 8px;">You've been invited to join the internal LoadLead platform team as
        <strong>${roleLabel}</strong>.</p>
      <p style="color:#888;font-size:13px;margin:0 0 24px;">Set a password to activate your staff account. This invite expires in 7 days and can only be used once.</p>
      <a href="${acceptUrl}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        Activate staff account
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">If you weren't expecting this, you can safely ignore it.</p>
    `));
  },

  async adminSetupInvite(to: string, name: string, setupUrl: string) {
    await send(to, '🔐 Your LoadLead Admin Setup Link', base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">You requested admin access</h2>
      <p style="color:#555;margin:0 0 8px;">Hi ${name},</p>
      <p style="color:#555;margin:0 0 24px;">
        Click the button below to complete your admin account setup on LoadLead.
        This link is valid for <strong>24 hours</strong> and can only be used once.
      </p>
      <a href="${setupUrl}"
         style="display:inline-block;background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        Complete Admin Setup
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:28px;">
        If you didn't request this, you can safely ignore this email.
        Once an admin account has been created, this link is permanently disabled.
      </p>
    `));
  },

  /**
   * Raw support-reply send. Threading lives in the headers
   * (Message-ID, In-Reply-To, References) -- we pass them through to
   * Resend so the recipient's email client stitches the reply into
   * their existing chain.
   */
  async sendRawSupportReply(params: {
    to: string; from: string; subject: string; bodyHtml: string;
    headers?: Record<string, string>;
  }) {
    await sendRawEmail(params);
  },

  async passwordReset(to: string, resetUrl: string) {
    await send(to, '🔐 Reset Your LoadLead Password', base(`
      <h2 style="margin:0 0 8px;color:#1a3a5c;">Password reset request</h2>
      <p style="color:#555;margin:0 0 24px;">We received a request to reset your password. Click the button below — this link expires in <strong>1 hour</strong>.</p>
      <a href="${resetUrl}"
         style="display:inline-block;background:#dc2626;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
        Reset Password
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">If you didn't request this, ignore this email. Your password won't change.</p>
    `));
  },
};
