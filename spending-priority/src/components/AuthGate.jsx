import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase";

export default function AuthGate() {
  return (
    <div style={{ textAlign: "center", padding: "3rem 1rem", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#aaa", textTransform: "uppercase", marginBottom: 10 }}>
        AI · Ma trận Eisenhower · Chi tiêu
      </div>
      <h2 style={{ fontWeight: 800, fontSize: 28, marginBottom: 8, letterSpacing: "-0.02em" }}>
        Nên chi tiền vào đâu?
      </h2>
      <p style={{ color: "#777", marginBottom: 28, fontSize: 14, lineHeight: 1.65 }}>
        Đăng nhập để dùng công cụ phân tích chi tiêu AI.
      </p>
      <button
        onClick={() => signInWithPopup(auth, googleProvider)}
        style={{
          padding: "12px 28px", fontSize: 15, fontWeight: 700,
          background: "#1a1a1a", color: "white",
          border: "none", borderRadius: 10, cursor: "pointer",
          transition: "background 0.2s",
        }}
        onMouseOver={e => (e.currentTarget.style.background = "#333")}
        onMouseOut={e => (e.currentTarget.style.background = "#1a1a1a")}
      >
        Đăng nhập với Google →
      </button>
    </div>
  );
}
