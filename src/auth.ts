import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Email-Allowlist: nur diese Mails duerfen sich einloggen.
// Komma-getrennt aus ALLOWED_EMAILS (Fallback: PRIMARY_EMAIL). Bei einem Self-Host
// traegst du hier deine eigene(n) Google-Adresse(n) ein.
function getAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? process.env.PRIMARY_EMAIL ?? "";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile",
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const allowed = getAllowedEmails();
      if (allowed.length === 0) return false; // nicht konfiguriert -> sicherheitshalber deny
      return allowed.includes(user.email.toLowerCase());
    },
    async session({ session, token }) {
      if (session.user && token.email) {
        session.user.email = token.email;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
  },
  session: { strategy: "jwt" },
  trustHost: true,
});
