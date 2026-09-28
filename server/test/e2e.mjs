// End-to-end check of the API against a running `wrangler dev` (local D1/R2).
//   pnpm --filter @toolbox/server dev        (in another terminal)
//   node server/test/e2e.mjs [http://127.0.0.1:8787]
// Needs ADMIN_EMAILS="admin@teste.dev" in server/.dev.vars. Uses fresh
// random e-mails on every run, so it can be re-run on the same database.
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;

function check(cond, label) {
  if (!cond) throw new Error(`FALHOU: ${label}`);
  passed++;
  console.log(`  ok  ${label}`);
}

async function api(path, { method = "GET", token, body, cookie, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

function refreshCookie(res) {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/tb_refresh=([^;]*)/);
  return m ? `tb_refresh=${m[1]}` : null;
}

const run = Math.random().toString(36).slice(2, 8);
const userEmail = `user-${run}@teste.dev`;
const password = "senha-forte-123";

console.log("\n# Termos e catálogo");
const terms = await api("/terms/current");
check(terms.status === 200 && terms.json.version >= 1, "termos atuais publicados");
const catalog = await api("/catalog");
check(catalog.json.tools.length === 12, "catálogo com 12 ferramentas");

console.log("\n# Cadastro");
let r = await api("/auth/signup", { method: "POST", body: { name: "Ana", email: userEmail, password, acceptedTermsVersion: 0 } });
check(r.status === 400 && r.json.error.code === "terms_required", "cadastro exige aceite da versão atual dos termos");
r = await api("/auth/signup", { method: "POST", body: { name: "Ana", email: userEmail, password: "curta", acceptedTermsVersion: terms.json.version } });
check(r.status === 400, "senha curta recusada");
r = await api("/auth/signup", { method: "POST", body: { name: "Ana", email: userEmail, password, acceptedTermsVersion: terms.json.version } });
check(r.status === 201 && r.json.accessToken && !r.json.user.emailVerified, "conta criada, e-mail ainda não verificado");
let access = r.json.accessToken;
let cookie = refreshCookie(r);
check(cookie !== null, "refresh token entregue em cookie HttpOnly");
const setCookie = r.headers.get("set-cookie");
check(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Path=\/api\/auth/i.test(setCookie), "cookie HttpOnly, SameSite=Strict, restrito a /api/auth");
r = await api("/auth/signup", { method: "POST", body: { name: "Ana", email: userEmail.toUpperCase(), password, acceptedTermsVersion: terms.json.version } });
check(r.status === 409, "e-mail duplicado (sem diferenciar maiúsculas) recusado");

console.log("\n# Login");
r = await api("/auth/login", { method: "POST", body: { email: userEmail, password: "errada-errada" } });
check(r.status === 401 && r.json.error.code === "invalid_credentials", "senha errada recusada");
r = await api("/auth/login", { method: "POST", body: { email: `ninguem-${run}@teste.dev`, password } });
check(r.status === 401 && r.json.error.code === "invalid_credentials", "e-mail inexistente dá a mesma resposta");
r = await api("/me", { token: access });
check(r.status === 200 && r.json.user.email === userEmail && r.json.terms.accepted, "/me com o token de acesso");
r = await api("/me", { token: access + "x" });
check(r.status === 401, "token adulterado recusado");

console.log("\n# Refresh (rotação e detecção de reuso)");
r = await api("/auth/refresh", { method: "POST", cookie });
check(r.status === 403, "refresh por cookie sem o header do app é recusado (CSRF)");
r = await api("/auth/refresh", { method: "POST", cookie, headers: { "x-toolbox-client": "web" } });
check(r.status === 200 && r.json.accessToken, "refresh por cookie funciona");
const oldCookie = cookie;
cookie = refreshCookie(r);
check(cookie && cookie !== oldCookie, "refresh token foi trocado");
access = r.json.accessToken;

console.log("\n# Verificação de e-mail (link lido do log do wrangler)");
const log = () => readFileSync(process.env.WRANGLER_LOG ?? resolve(process.env.TEMP ?? "/tmp", "wrangler-dev.log"), "utf8");
const lastLink = (email, path) => {
  const re = new RegExp(`to=${email.replace(/[.+]/g, "\\$&")}[^\\n]*${path}\\?token=([^\\s]+)`, "g");
  const matches = [...log().matchAll(re)];
  return matches.length ? decodeURIComponent(matches[matches.length - 1][1]) : null;
};
const verifyToken = lastLink(userEmail, "verificar-email");
check(verifyToken, "e-mail de verificação enviado (logado em dev)");

console.log("\n# Login do desktop (device flow)");
const code = await api("/device/code", { method: "POST", body: { deviceName: "PC-TESTE", platform: "windows" } });
check(code.status === 200 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.json.userCode), `código gerado: ${code.json.userCode}`);
r = await api("/device/token", { method: "POST", body: { deviceCode: code.json.deviceCode } });
check(r.status === 400 && r.json.error.code === "authorization_pending", "desktop aguardando confirmação");
r = await api(`/device/lookup?code=${code.json.userCode.toLowerCase().replace("-", "")}`, { token: access });
check(r.status === 200 && r.json.deviceName === "PC-TESTE", "site mostra o computador pedindo acesso (código digitado sem traço/minúsculo)");
r = await api("/device/approve", { method: "POST", token: access, body: { code: code.json.userCode } });
check(r.status === 403 && r.json.error.code === "email_not_verified", "aprovação exige e-mail verificado");
r = await api("/auth/verify-email", { method: "POST", body: { token: verifyToken } });
check(r.status === 200, "e-mail verificado pelo link");
r = await api("/auth/verify-email", { method: "POST", body: { token: verifyToken } });
check(r.status === 400, "link de verificação não funciona duas vezes");
r = await api("/device/approve", { method: "POST", token: access, body: { code: code.json.userCode } });
check(r.status === 200, "computador aprovado no site");
await new Promise((ok) => setTimeout(ok, 4200));
r = await api("/device/token", { method: "POST", body: { deviceCode: code.json.deviceCode } });
check(r.status === 200 && r.json.refreshToken && r.json.accessToken, "desktop recebeu sua sessão");
let desktopRefresh = r.json.refreshToken;
let desktopAccess = r.json.accessToken;
r = await api("/device/token", { method: "POST", body: { deviceCode: code.json.deviceCode } });
check(r.status === 400 && r.json.error.code === "expired_token", "código de dispositivo não pode ser usado de novo");

console.log("\n# Plano assinado (entitlement token)");
r = await api("/me/entitlement-token", { token: desktopAccess });
check(r.status === 200 && r.json.entitlements.diamond === false, "plano Grátis por padrão");
const pub = readFileSync(resolve(here, "../../src-tauri/keys/entitlement_public.b64"), "utf8").trim();
async function verifyEntitlement(token) {
  const [h, p, s] = token.split(".");
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(pub, "base64"), { name: "Ed25519" }, false, ["verify"]);
  const ok = await webcrypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(s, "base64url"), Buffer.from(`${h}.${p}`));
  return ok ? JSON.parse(Buffer.from(p, "base64url").toString()) : null;
}
check((await verifyEntitlement(r.json.token))?.sub, "assinatura confere com a chave pública embutida no app");

console.log("\n# Refresh do desktop e roubo de token");
r = await api("/auth/refresh", { method: "POST", body: { refreshToken: desktopRefresh } });
check(r.status === 200 && r.json.refreshToken !== desktopRefresh, "desktop renova e recebe novo refresh token");
const stolen = desktopRefresh;
desktopRefresh = r.json.refreshToken;
desktopAccess = r.json.accessToken;
await new Promise((ok) => setTimeout(ok, 31000)); // past the concurrent-refresh grace window
r = await api("/auth/refresh", { method: "POST", body: { refreshToken: stolen } });
check(r.status === 401, "refresh token antigo recusado");
r = await api("/auth/refresh", { method: "POST", body: { refreshToken: desktopRefresh } });
check(r.status === 401, "reuso detectado: a sessão inteira foi derrubada");
r = await api("/me", { token: desktopAccess });
check(r.status === 401, "token de acesso da sessão derrubada para de funcionar na hora");

console.log("\n# Admin");
const adminEmail = "admin@teste.dev";
r = await api("/auth/login", { method: "POST", body: { email: adminEmail, password } });
if (r.status === 401) {
  r = await api("/auth/signup", { method: "POST", body: { name: "Admin", email: adminEmail, password, acceptedTermsVersion: terms.json.version } });
}
check(r.json.user?.role === "admin", "e-mail em ADMIN_EMAILS vira administrador");
const admin = r.json.accessToken;
r = await api("/admin/users", { token: access });
check(r.status === 403, "usuário comum não acessa o admin");
r = await api(`/admin/users?q=${encodeURIComponent(userEmail)}`, { token: admin });
check(r.status === 200 && r.json.total === 1, "busca de usuário no admin");
const userId = r.json.items[0].id;
r = await api(`/admin/users/${userId}/subscriptions`, { method: "POST", token: admin, body: { toolId: "ocr", tier: "silver" } });
check(r.status === 201 && r.json.entitlements.tools.ocr === "silver", "admin liberou OCR Prata");
r = await api(`/admin/users/${userId}/subscriptions`, { method: "POST", token: admin, body: { toolId: "ocr", tier: "diamond" } });
check(r.status === 400, "Diamante só vale para todas as ferramentas");
r = await api(`/admin/users/${userId}/subscriptions`, { method: "POST", token: admin, body: { toolId: "*", tier: "diamond", endsAt: Date.now() + 86400000 } });
check(r.status === 201 && r.json.entitlements.diamond, "admin liberou Diamante por 1 dia");
const diamondId = r.json.subscriptions.find((s) => s.tier === "diamond").id;
r = await api(`/admin/subscriptions/${diamondId}`, { method: "DELETE", token: admin });
check(r.status === 200 && !r.json.entitlements.diamond && r.json.entitlements.tools.ocr === "silver", "cancelar o Diamante mantém o OCR Prata");
r = await api("/me", { token: access });
check(r.json.entitlements.tools.ocr === "silver", "usuário vê o novo plano");

console.log("\n# Ferramentas escolhidas");
r = await api("/me/tools", { method: "PUT", token: access, body: { tools: ["ocr", "calculator", "inexistente"] } });
check(r.status === 400, "ferramenta desconhecida recusada");
r = await api("/me/tools", { method: "PUT", token: access, body: { tools: ["ocr", "calculator"] } });
check(r.status === 200 && r.json.tools.join() === "calculator,ocr", "seleção de ferramentas salva");

console.log("\n# Downloads");
const content = Buffer.from(`instalador de teste ${run}`);
const form = new FormData();
form.set("kind", "app");
form.set("target", "windows-x64");
form.set("version", `0.1.${Date.now()}`);
form.set("file", new Blob([content]), "ToolBox_setup.exe");
let res = await fetch(`${BASE}/api/admin/releases`, { method: "POST", headers: { authorization: `Bearer ${admin}` }, body: form });
const release = await res.json();
check(res.status === 201 && release.sha256 === createHash("sha256").update(content).digest("hex"), "admin publicou instalador (sha256 calculado no upload)");
r = await api("/downloads", { token: access });
check(r.json.app.some((a) => a.id === release.id), "usuário vê o instalador mais recente");
r = await api(`/downloads/${release.id}/link`, { method: "POST", token: access });
check(r.status === 200 && r.json.url.includes("sig="), "link assinado gerado");
res = await fetch(r.json.url);
const downloaded = Buffer.from(await res.arrayBuffer());
check(res.status === 200 && downloaded.equals(content), "download pelo link assinado");
check(/attachment/.test(res.headers.get("content-disposition") ?? ""), "baixa como anexo");
res = await fetch(r.json.url.replace(/sig=[^&]+/, "sig=AAAA"));
check(res.status === 403, "link com assinatura adulterada recusado");
res = await fetch(r.json.url.replace(/uid=[^&]+/, "uid=outro"));
check(res.status === 403, "link não funciona para outro usuário");
r = await api(`/admin/releases/${release.id}`, { method: "DELETE", token: admin });
check(r.status === 204, "admin removeu a versão");

console.log("\n# Redefinição de senha");
r = await api("/auth/forgot-password", { method: "POST", body: { email: userEmail } });
check(r.status === 200, "pedido de redefinição");
r = await api("/auth/forgot-password", { method: "POST", body: { email: `ninguem-${run}@teste.dev` } });
check(r.status === 200, "mesma resposta para e-mail inexistente");
const resetToken = lastLink(userEmail, "redefinir-senha");
check(resetToken, "e-mail de redefinição enviado");
r = await api("/auth/reset-password", { method: "POST", body: { token: resetToken, password: "nova-senha-456" } });
check(r.status === 200, "senha redefinida");
r = await api("/me", { token: access });
check(r.status === 401, "redefinir a senha encerra as sessões abertas");
r = await api("/auth/login", { method: "POST", body: { email: userEmail, password: "nova-senha-456" } });
check(r.status === 200, "login com a nova senha");
access = r.json.accessToken;

console.log("\n# Novos termos");
r = await api("/admin/terms", { method: "POST", token: admin, body: { title: "Termos v teste", content: "Conteúdo de teste dos termos, longo o bastante para passar na validação." } });
check(r.status === 201, "admin publicou nova versão dos termos");
const newVersion = r.json.version;
r = await api("/me", { token: access });
check(r.json.terms.accepted === false, "usuário precisa aceitar a nova versão");
r = await api("/me/entitlement-token", { token: access });
check(r.status === 403 && r.json.error.code === "terms_required", "app desktop bloqueado até aceitar");
r = await api("/me/terms/accept", { method: "POST", token: access, body: { version: newVersion } });
check(r.status === 200, "termos aceitos");
r = await api("/me/entitlement-token", { token: access });
check(r.status === 200, "app liberado de novo");

console.log("\n# Bloqueio de conta");
r = await api(`/admin/users/${userId}`, { method: "PATCH", token: admin, body: { status: "blocked" } });
check(r.status === 200 && r.json.user.status === "blocked" && r.json.sessions.length === 0, "admin bloqueou e derrubou as sessões");
r = await api("/me", { token: access });
check(r.status === 401, "usuário bloqueado perde o acesso na hora");
r = await api("/auth/login", { method: "POST", body: { email: userEmail, password: "nova-senha-456" } });
check(r.status === 403 && r.json.error.code === "account_blocked", "usuário bloqueado não consegue entrar");

console.log(`\n${passed} verificações passaram.`);
