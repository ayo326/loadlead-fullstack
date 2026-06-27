// The actual Resend call now routes through services/integrations/email.ts
// — every public method below (welcome, loadMatched, ...) is unchanged.
import { sendEmail, sendRawEmail } from './integrations/email';

async function send(to: string, subject: string, html: string) {
  await sendEmail(to, subject, html);
}

// Brand-matched email shell. Email clients block custom fonts and CSS
// filters and many ignore flexbox, so this uses a web-safe font stack, a
// table layout, and a WHITE header carrying the real (black) LoadLead logo
// — the brand accent shows as a gradient top bar (with a solid fallback for
// Outlook) and the footer carries the "Where loads meet leads." brand line.
// Brand hexes: primary #0a3f9e (217 91% 32%), accent #3b82f6 (217 91% 60%).
function base(body: string) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;">
      <tr><td align="center" style="padding:28px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(13,38,76,.10);">
          <tr><td style="height:4px;background:#0a3f9e;background:linear-gradient(90deg,#0a3f9e 0%,#3b82f6 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:22px 32px 18px;border-bottom:1px solid #eef2f7;">
            <img src="https://loadleadapp.com/loadlead-logo.png" alt="LoadLead" height="26" style="height:26px;width:auto;display:block;border:0;outline:none;text-decoration:none;">
          </td></tr>
          <tr><td style="padding:32px;">${body}</td></tr>
          <tr><td style="padding:20px 32px;background:#f7f9fc;border-top:1px solid #eef2f7;">
            <div style="font-size:12px;color:#64748b;font-weight:600;letter-spacing:.2px;">Where loads meet leads.</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:5px;">© ${year} LoadLead · <a href="https://loadleadapp.com" style="color:#3b82f6;text-decoration:none;">loadleadapp.com</a></div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
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
      <h2 style="margin:0 0 8px;color:#0a3f9e;font-size:22px;">Thanks for your interest in LoadLead</h2>
      <p style="color:#475569;margin:0 0 8px;line-height:1.55;">You're on the founding-beta mailing list. We're admitting shippers and carriers in small, balanced waves.</p>
      <p style="color:#475569;margin:0 0 24px;line-height:1.55;">Want to be considered for the current wave? Take ~3 minutes to tell us about your freight:</p>
      <a href="${formUrl}"
         style="display:inline-block;background:#0a3f9e;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Apply to the beta
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">If you'd rather just stay on the list, no action needed — we'll reach out as seats open.</p>
    `));
  },

  /**
   * Beta ADMIT email. Sent automatically when a staff member admits a beta
   * applicant. Hands them their private access link on the beta subdomain
   * (beta.loadleadapp.com) where the full product lives during private beta.
   */
  async betaAdmitInvite(to: string, acceptUrl: string, cohort?: string) {
    await send(to, `You're in — your LoadLead private beta access`, base(`
      <div style="display:inline-block;background:#e8f0fe;color:#0a3f9e;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:5px 11px;border-radius:999px;margin-bottom:14px;">Private beta · Admitted</div>
      <h2 style="margin:0 0 8px;color:#0a3f9e;font-size:22px;">You're in the LoadLead private beta 🎉</h2>
      <p style="color:#475569;margin:0 0 8px;line-height:1.55;">We reviewed your application and you've been admitted${cohort ? ` to the <strong>${cohort}</strong> cohort` : ''}. Welcome aboard.</p>
      <p style="color:#475569;margin:0 0 24px;line-height:1.55;">Click below to set up your account and start using LoadLead. This is your private beta link — please don't share it.</p>
      <a href="${acceptUrl}"
         style="display:inline-block;background:#0a3f9e;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Set up my account
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">During private beta the app lives at <a href="https://beta.loadleadapp.com" style="color:#3b82f6;text-decoration:none;">beta.loadleadapp.com</a>. This invite expires in 7 days.</p>
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
