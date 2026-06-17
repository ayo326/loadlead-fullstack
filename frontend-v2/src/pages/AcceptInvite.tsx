import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Building2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; orgName: string; orgRole: string; userRole: string; email: string; alreadyAccepted: boolean }
  | { status: "accepted" };

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { user } = useAuth();

  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [accepting, setAccepting] = useState(false);

  // Load invitation preview
  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: "No invitation token found in the URL." });
      return;
    }
    api.getInvitationPreview(token)
      .then(inv => {
        if (inv.alreadyAccepted) {
          setState({ status: "error", message: "This invitation has already been used." });
        } else {
          setState({
            status: "ok",
            orgName: inv.orgName,
            orgRole: inv.orgRole,
            userRole: inv.userRole,
            email: inv.email,
            alreadyAccepted: false,
          });
        }
      })
      .catch(err => setState({ status: "error", message: err.message ?? "Invalid or expired invitation." }));
  }, [token]);

  const handleAccept = async () => {
    if (!user) {
      // Redirect to signup/login with a return URL
      navigate(`/login?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`);
      return;
    }
    setAccepting(true);
    try {
      await api.acceptInvitation(token);
      setState({ status: "accepted" });
    } catch (err: any) {
      setState({ status: "error", message: err.message ?? "Failed to accept invitation." });
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="mb-8"><Logo /></div>

      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-sm p-8 space-y-6">

        {/* Loading */}
        {state.status === "loading" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">Loading invitation…</p>
          </div>
        )}

        {/* Error */}
        {state.status === "error" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <XCircle className="h-12 w-12 text-destructive" />
            <h2 className="text-xl font-semibold">Invitation unavailable</h2>
            <p className="text-muted-foreground text-sm">{state.message}</p>
            <Button variant="outline" asChild><Link to="/">Go home</Link></Button>
          </div>
        )}

        {/* Preview */}
        {state.status === "ok" && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">You've been invited!</h2>
                <p className="text-sm text-muted-foreground">Join <strong>{state.orgName}</strong> on LoadLead</p>
              </div>
            </div>

            <div className="rounded-xl bg-secondary/50 border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invited email</span>
                <span className="font-medium">{state.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your role</span>
                <span className="font-medium capitalize">{state.userRole.toLowerCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Org permission</span>
                <span className="font-medium capitalize">{state.orgRole.toLowerCase()}</span>
              </div>
            </div>

            {!user && (
              <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                You'll need to log in (or create an account) before accepting.
              </p>
            )}

            <Button className="w-full h-11" onClick={handleAccept} disabled={accepting}>
              {accepting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Accepting…</> : "Accept invitation"}
            </Button>
          </>
        )}

        {/* Accepted */}
        {state.status === "accepted" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <h2 className="text-xl font-semibold">You're in!</h2>
            <p className="text-muted-foreground text-sm">You've successfully joined the organisation.</p>
            <Button onClick={() => navigate("/")}>Go to dashboard</Button>
          </div>
        )}

      </div>
    </div>
  );
}
