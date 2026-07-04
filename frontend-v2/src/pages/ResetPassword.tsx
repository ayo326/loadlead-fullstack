import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Truck, Lock, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [mode, setMode] = useState<"forgot" | "reset">(token ? "reset" : "forgot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally { setLoading(false); }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err: any) {
      toast.error(err.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="font-display-hangar min-h-screen bg-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="h-10 w-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <span className="text-white font-bold text-xl">LoadLead</span>
        </div>

        <div className="bg-white/10 backdrop-blur rounded-lg p-8 border border-white/10">
          {/* Forgot password - request form */}
          {mode === "forgot" && !sent && (
            <>
              <h1 className="text-white text-xl font-bold mb-1">Forgot password?</h1>
              <p className="text-white/60 text-sm mb-6">Enter your email and we'll send a reset link.</p>
              <form onSubmit={submitForgot} className="space-y-4">
                <Input
                  type="email" required placeholder="your@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
              </form>
            </>
          )}

          {/* Sent confirmation */}
          {mode === "forgot" && sent && (
            <div className="text-center">
              <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <h2 className="text-white font-bold text-lg mb-2">Check your email</h2>
              <p className="text-white/60 text-sm">If <strong>{email}</strong> is registered, you'll receive a reset link within a minute.</p>
            </div>
          )}

          {/* Reset password form */}
          {mode === "reset" && !done && (
            <>
              <div className="flex items-center gap-2 mb-6">
                <Lock className="h-5 w-5 text-white/60" />
                <h1 className="text-white text-xl font-bold">Set new password</h1>
              </div>
              <form onSubmit={submitReset} className="space-y-4">
                <Input
                  type="password" required placeholder="New password (8+ chars)"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                />
                <Input
                  type="password" required placeholder="Confirm new password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Updating…" : "Update password"}
                </Button>
              </form>
            </>
          )}

          {/* Done */}
          {mode === "reset" && done && (
            <div className="text-center">
              <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <h2 className="text-white font-bold text-lg mb-2">Password updated!</h2>
              <p className="text-white/60 text-sm">Redirecting you to login…</p>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link to="/login" className="text-white/50 text-sm hover:text-white flex items-center justify-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
