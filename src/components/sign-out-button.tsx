"use client";

export function SignOutButton({
  className = "sign-out-button",
}: {
  className?: string;
}) {
  return (
    <form className="sign-out-form" action="/auth/signout" method="post">
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
