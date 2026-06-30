// frontend/src/App.tsx
import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import MobileAdminDashboard from "./pages/MobileAdminDashboard";
import TraderDashboard from "./pages/TraderDashboard";

const isMobile = () => window.innerWidth <= 768;

export default function App() {
  const [role, setRole]         = useState<string | null>(null);
  const [traderId, setTraderId] = useState("");
  const [loading, setLoading]   = useState(true);
  const [mobile, setMobile]     = useState(isMobile);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data: profile } = await supabase
          .from("user_profiles").select("*").eq("id", session.user.id).single();
        if (profile) { setRole(profile.role); setTraderId(profile.trader_id || ""); }
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const handler = () => setMobile(isMobile());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const handleLogin = (r: string, tid: string) => { setRole(r); setTraderId(tid); };
  const handleLogout = () => { setRole(null); setTraderId(""); };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#070C15", display: "flex", alignItems: "center", justifyContent: "center", color: "#00C8FF", fontSize: 14, fontFamily: "monospace" }}>
      Loading...
    </div>
  );

  if (!role) return <Login onLogin={handleLogin} />;
  if (role === "admin") return mobile
    ? <MobileAdminDashboard onLogout={handleLogout} />
    : <AdminDashboard onLogout={handleLogout} />;
  return <TraderDashboard traderId={traderId} onLogout={handleLogout} />;
}
