import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={<div className="text-muted-foreground text-sm">Laden...</div>}>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}
