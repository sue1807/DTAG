// frontend/src/pages/Login.tsx
import { useState } from "react";
import { signIn } from "../lib/supabase";

export default function Login({ onLogin }: { onLogin: (role: string, traderId: string) => void }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const { profile } = await signIn(email, password);
      onLogin(profile.role, profile.trader_id || "");
    } catch {
      setError("邮箱或密码错误");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070C15", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ background: "#0F1C30", border: "1px solid #182840", borderTop: "2px solid #00C8FF", borderRadius: 16, padding: 40, width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#00C8FF" }}>交易室管理系统</div>
          <div style={{ fontSize: 12, color: "#4A6882", marginTop: 6 }}>Group 31O-1232</div>
        </div>
        <form onSubmit={handleSubmit}>
          {[["邮箱", email, setEmail, "email", "your@email.com"], ["密码", password, setPassword, "password", "••••••••"]].map(([label, val, setter, type, ph]: any) => (
            <div key={label as string} style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: "#4A6882", display: "block", marginBottom: 6 }}>{label}</label>
              <input type={type} required value={val} onChange={e => setter(e.target.value)} placeholder={ph}
                style={{ width: "100%", background: "#070C15", border: "1px solid #182840", borderRadius: 8, padding: "11px 14px", color: "#C4DAF0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}
          {error && <div style={{ background: "#FF284715", border: "1px solid #FF284744", borderRadius: 8, padding: "9px 14px", fontSize: 12, color: "#FF2847", marginBottom: 16 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: "100%", padding: 13, background: "#00C8FF20", border: "1px solid #00C8FF", borderRadius: 10, color: "#00C8FF", fontSize: 14, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
