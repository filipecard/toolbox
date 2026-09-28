import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./styles.css";
import { AuthProvider } from "./auth";
import { Layout, RequireAuth } from "./Layout";
import { Account } from "./pages/Account";
import { Activate } from "./pages/Activate";
import { Admin } from "./pages/admin/Admin";
import { ForgotPassword, Login, ResetPassword, Signup, VerifyEmail } from "./pages/AuthPages";
import { Download } from "./pages/Download";
import { Home } from "./pages/Home";
import { NotFound, Terms } from "./pages/Terms";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="entrar" element={<Login />} />
            <Route path="cadastro" element={<Signup />} />
            <Route path="esqueci-senha" element={<ForgotPassword />} />
            <Route path="redefinir-senha" element={<ResetPassword />} />
            <Route path="verificar-email" element={<VerifyEmail />} />
            <Route path="termos" element={<Terms />} />
            <Route path="conta" element={<RequireAuth><Account /></RequireAuth>} />
            <Route path="download" element={<RequireAuth><Download /></RequireAuth>} />
            <Route path="ativar" element={<RequireAuth><Activate /></RequireAuth>} />
            <Route path="admin/*" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
