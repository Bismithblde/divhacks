import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

function AuthFallback() {
  return (
    <main className="auth-page">
      <div className="auth-loading" role="status">
        Loading account access…
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthForm />
    </Suspense>
  );
}
