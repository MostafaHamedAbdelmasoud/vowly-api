// مثال استدعاء الدالة من React (أو أي Frontend)
// غيّر الـ URL لرابط مشروعك على Vercel (أو دومينك لو ربطته)

const API_URL = "https://vowly-api.vercel.app/api/send";

// إرسال تمبلت معتمد مع المتغيرات
export async function sendInvitation(to, variables) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, variables }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "فشل الإرسال");
  return data; // { success: true, sid, status }
}

// الاستخدام:
// await sendInvitation("+201012345678", { "1": "أحمد", "2": "٢٠ ديسمبر" });

// ------- نسخة React component صغيرة -------
/*
import { useState } from "react";
import { sendInvitation } from "./client-example";

export default function SendForm() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");

  async function handleSend(e) {
    e.preventDefault();
    setStatus("جاري الإرسال...");
    try {
      await sendInvitation(phone, { "1": name });
      setStatus("تم الإرسال ✅");
    } catch (err) {
      setStatus("خطأ: " + err.message);
    }
  }

  return (
    <form onSubmit={handleSend}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الضيف" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2010..." />
      <button type="submit">ابعت الدعوة</button>
      <p>{status}</p>
    </form>
  );
}
*/
