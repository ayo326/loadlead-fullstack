/**
 * Part B unit proofs — auto-qualify hard gates + the 7-dimension scorer.
 * Pure functions, no DB. Maps to the TASK acceptance bullets:
 *
 *   carrier with no MC/DOT → WAITLISTED/DISQUALIFIED
 *   shipper under 5/week    → WAITLISTED
 *   not running freight / won't commit → WAITLISTED
 *   qualifying → QUALIFIED
 *   MOSTLY-Texas applicant scores Geography=3
 */

import { describe, it, expect } from 'vitest';
import { autoQualify } from '../../../src/services/betaAutoQualify';
import {
  geographyScore, volumeBand, toolsScore,
  preComputeObjective, applyStaffScores, totalOf, findLaneOverlaps,
} from '../../../src/services/betaScoring';

const baseCommitment = { realFreight: true, feedbackCall: true };

describe('autoQualify — hard gates', () => {
  it('carrier with NO MC/DOT → DISQUALIFIED + carrier_no_mc_dot', () => {
    const r = autoQualify({
      side: 'CARRIER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { carrier: { truckCount: 3 } },  // no mcOrDot
      commitment: baseCommitment,
    });
    expect(r.status).toBe('DISQUALIFIED');
    expect(r.autoFlags).toContain('carrier_no_mc_dot');
  });

  it('carrier with a valid MC number → not flagged for MC/DOT', () => {
    const r = autoQualify({
      side: 'CARRIER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { carrier: { mcOrDot: 'MC123456', loadsPerWeek: 12 } },
      commitment: baseCommitment,
    });
    expect(r.autoFlags).not.toContain('carrier_no_mc_dot');
    expect(r.status).toBe('QUALIFIED');
  });

  it('shipper under 5 loads/week → WAITLISTED + shipper_low_volume', () => {
    const r = autoQualify({
      side: 'SHIPPER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { shipper: { loadsPerWeek: 3 } },
      commitment: baseCommitment,
    });
    expect(r.status).toBe('WAITLISTED');
    expect(r.autoFlags).toContain('shipper_low_volume');
  });

  it('shipper at exactly 5 loads/week → QUALIFIED (boundary)', () => {
    const r = autoQualify({
      side: 'SHIPPER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { shipper: { loadsPerWeek: 5 } },
      commitment: baseCommitment,
    });
    expect(r.status).toBe('QUALIFIED');
    expect(r.autoFlags).toHaveLength(0);
  });

  it('not running freight → WAITLISTED + not_running_freight', () => {
    const r = autoQualify({
      side: 'SHIPPER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { shipper: { loadsPerWeek: 20 } },
      commitment: { realFreight: false, feedbackCall: true },
    });
    expect(r.status).toBe('WAITLISTED');
    expect(r.autoFlags).toContain('not_running_freight');
  });

  it('won\'t commit to feedback → WAITLISTED + wont_commit_to_feedback', () => {
    const r = autoQualify({
      side: 'SHIPPER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { shipper: { loadsPerWeek: 20 } },
      commitment: { realFreight: true, feedbackCall: false },
    });
    expect(r.status).toBe('WAITLISTED');
    expect(r.autoFlags).toContain('wont_commit_to_feedback');
  });

  it('OUTSIDE Texas in Wave 1 → WAITLISTED (not disqualified)', () => {
    const r = autoQualify(
      {
        side: 'SHIPPER',
        texasFocus: 'OUTSIDE',
        sideSpecificData: { shipper: { loadsPerWeek: 20 } },
        commitment: baseCommitment,
      },
      { currentWave: 'wave-1' },
    );
    expect(r.status).toBe('WAITLISTED');
    expect(r.autoFlags).toContain('outside_texas_strict_wave');
  });

  it('OUTSIDE Texas in Wave 2 → not Texas-flagged', () => {
    const r = autoQualify(
      {
        side: 'SHIPPER',
        texasFocus: 'OUTSIDE',
        sideSpecificData: { shipper: { loadsPerWeek: 20 } },
        commitment: baseCommitment,
      },
      { currentWave: 'wave-2' },
    );
    expect(r.autoFlags).not.toContain('outside_texas_strict_wave');
    expect(r.status).toBe('QUALIFIED');
  });

  it('DISQUALIFIED beats WAITLISTED when both apply (records both flags)', () => {
    const r = autoQualify({
      side: 'BOTH',
      texasFocus: 'MOSTLY',
      sideSpecificData: {
        carrier: { truckCount: 1 },                 // no MC/DOT → disqualify
        shipper: { loadsPerWeek: 2 },               // low volume → waitlist
      },
      commitment: baseCommitment,
    });
    expect(r.status).toBe('DISQUALIFIED');
    expect(r.autoFlags).toEqual(expect.arrayContaining(['carrier_no_mc_dot', 'shipper_low_volume']));
  });

  it('fully qualifying applicant → QUALIFIED, no flags', () => {
    const r = autoQualify({
      side: 'SHIPPER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { shipper: { loadsPerWeek: 30, bookingMethod: 'email + spreadsheets' } },
      commitment: baseCommitment,
    });
    expect(r.status).toBe('QUALIFIED');
    expect(r.autoFlags).toHaveLength(0);
  });
});

describe('scoring — objective dimensions', () => {
  it('Geography: MOSTLY=3, PARTLY=2, OUTSIDE=0', () => {
    expect(geographyScore('MOSTLY')).toBe(3);
    expect(geographyScore('PARTLY')).toBe(2);
    expect(geographyScore('OUTSIDE')).toBe(0);
  });

  it('Volume bands: <5=0, 5-9=1, 10-24=2, 25+=3', () => {
    expect(volumeBand(3)).toBe(0);
    expect(volumeBand(5)).toBe(1);
    expect(volumeBand(9)).toBe(1);
    expect(volumeBand(10)).toBe(2);
    expect(volumeBand(24)).toBe(2);
    expect(volumeBand(25)).toBe(3);
    expect(volumeBand(100)).toBe(3);
    expect(volumeBand(undefined)).toBe(0);
  });

  it('Tools: 1 when a booking/find method is present, else 0', () => {
    expect(toolsScore('SHIPPER', { shipper: { bookingMethod: 'DAT' } })).toBe(1);
    expect(toolsScore('SHIPPER', { shipper: { bookingMethod: '' } })).toBe(0);
    expect(toolsScore('CARRIER', { carrier: { findMethod: 'load boards' } })).toBe(1);
    expect(toolsScore('CARRIER', {})).toBe(0);
  });

  it('preComputeObjective fills AUTO dims; staff dims default to 0', () => {
    const b = preComputeObjective({
      side: 'SHIPPER',
      texasFocus: 'MOSTLY',
      sideSpecificData: { shipper: { loadsPerWeek: 12, bookingMethod: 'email' } },
    });
    expect(b.volume).toBe(2);       // 10-24
    expect(b.geography).toBe(3);    // MOSTLY
    expect(b.tools).toBe(1);        // has bookingMethod
    expect(b.segmentFit).toBe(0);
    expect(b.pain).toBe(0);
    expect(b.responsiveness).toBe(0);
    expect(b.laneOverlap).toBe(0);
  });

  it('applyStaffScores merges staff dims + recomputes AUTO dims (tamper-proof)', () => {
    const app = {
      side: 'SHIPPER' as const,
      texasFocus: 'MOSTLY' as const,
      sideSpecificData: { shipper: { loadsPerWeek: 30, bookingMethod: 'TMS' } },
    };
    const { breakdown, total } = applyStaffScores(app, undefined, {
      segmentFit: 3, pain: 2, responsiveness: 1, laneOverlap: 2,
    });
    // AUTO dims come from the data regardless of what staff send
    expect(breakdown.volume).toBe(3);
    expect(breakdown.geography).toBe(3);
    expect(breakdown.tools).toBe(1);
    // STAFF dims applied
    expect(breakdown.segmentFit).toBe(3);
    expect(breakdown.pain).toBe(2);
    expect(breakdown.responsiveness).toBe(1);
    expect(breakdown.laneOverlap).toBe(2);
    // Total = 3+3+3+2+2+1+1 = 15 (a perfect score)
    expect(total).toBe(15);
    expect(totalOf(breakdown)).toBe(15);
  });

  it('staff scores are clamped to their max (segmentFit caps at 3)', () => {
    const app = {
      side: 'SHIPPER' as const,
      texasFocus: 'OUTSIDE' as const,
      sideSpecificData: { shipper: { loadsPerWeek: 1 } },
    };
    const { breakdown } = applyStaffScores(app, undefined, { segmentFit: 99 as any });
    expect(breakdown.segmentFit).toBe(3);
  });
});

describe('lane-overlap helper', () => {
  const shipper = {
    applicationId: 'ship-1',
    side: 'SHIPPER' as const,
    texasFocus: 'MOSTLY' as const,
    sideSpecificData: { shipper: { lanes: ['Dallas → Houston', 'Austin → San Antonio'] } },
  };
  const carrierMatch = {
    applicationId: 'car-1', side: 'CARRIER' as const, texasFocus: 'MOSTLY' as const,
    fullName: 'Match Carrier', company: 'MC', workEmail: 'm@c.com',
    sideSpecificData: { carrier: { lanes: ['Houston → Dallas'] } },
  };
  const carrierNoMatch = {
    applicationId: 'car-2', side: 'CARRIER' as const, texasFocus: 'OUTSIDE' as const,
    fullName: 'No Match', company: 'NM', workEmail: 'n@m.com',
    sideSpecificData: { carrier: { lanes: ['Seattle → Portland'] } },
  };

  it('surfaces a carrier sharing a lane region', () => {
    const r = findLaneOverlaps(shipper, [carrierMatch, carrierNoMatch]);
    const ids = r.map(x => x.applicationId);
    expect(ids).toContain('car-1');
  });

  it('Texas-MOSTLY pairs sort to the top even without exact lane match', () => {
    const texasCarrierNoLane = {
      applicationId: 'car-3', side: 'CARRIER' as const, texasFocus: 'MOSTLY' as const,
      fullName: 'TX Carrier', company: 'TX', workEmail: 't@x.com',
      sideSpecificData: { carrier: { lanes: ['El Paso → Lubbock'] } },
    };
    const r = findLaneOverlaps(shipper, [carrierNoMatch, texasCarrierNoLane]);
    // texasCarrierNoLane surfaces (bothTexas) and sorts above the OUTSIDE one
    expect(r[0].applicationId).toBe('car-3');
    expect(r[0].bothTexas).toBe(true);
  });
});
