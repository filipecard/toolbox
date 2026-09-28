import type { Env } from "../env";

interface Message {
  to: string;
  subject: string;
  /** Plain paragraphs; the link is rendered as a button. */
  paragraphs: string[];
  action: { label: string; url: string };
  footer: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function renderHtml(m: Message): string {
  const body = m.paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2328">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:10px;padding:28px">
<tr><td>
<h1 style="margin:0 0 18px;font-size:20px">ToolBox</h1>
${body}
<p style="margin:22px 0"><a href="${escapeHtml(m.action.url)}" style="background:#d70909;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:7px;display:inline-block;font-weight:600">${escapeHtml(m.action.label)}</a></p>
<p style="margin:0 0 6px;font-size:12px;color:#6a6d75">Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(m.action.url)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#6a6d75">${escapeHtml(m.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function renderText(m: Message): string {
  return [...m.paragraphs, "", `${m.action.label}: ${m.action.url}`, "", m.footer].join("\n");
}

async function send(env: Env, message: Message): Promise<void> {
  if (!env.EMAIL) {
    // Local development: no e-mail domain configured — the link is logged
    // so the flow can still be tested.
    console.log(`[email] to=${message.to} subject="${message.subject}" link=${message.action.url}`);
    return;
  }
  await env.EMAIL.send({
    to: message.to,
    from: { email: env.EMAIL_FROM, name: "ToolBox" },
    subject: message.subject,
    html: renderHtml(message),
    text: renderText(message),
  });
}

export function sendVerificationEmail(env: Env, to: string, name: string, token: string) {
  return send(env, {
    to,
    subject: "Confirme seu e-mail no ToolBox",
    paragraphs: [`Olá, ${name}!`, "Confirme seu endereço de e-mail para ativar todos os recursos da sua conta."],
    action: { label: "Confirmar e-mail", url: `${env.WEB_BASE_URL}/verificar-email?token=${encodeURIComponent(token)}` },
    footer: "O link vale por 24 horas. Se você não criou uma conta no ToolBox, ignore este e-mail.",
  });
}

export function sendPasswordResetEmail(env: Env, to: string, name: string, token: string) {
  return send(env, {
    to,
    subject: "Redefinição de senha do ToolBox",
    paragraphs: [`Olá, ${name}!`, "Recebemos um pedido para redefinir a senha da sua conta."],
    action: { label: "Criar nova senha", url: `${env.WEB_BASE_URL}/redefinir-senha?token=${encodeURIComponent(token)}` },
    footer:
      "O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.",
  });
}
