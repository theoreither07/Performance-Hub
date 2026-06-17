import { prisma } from "@/lib/db/prisma";
import { auth } from "@/auth";

// Liefert den aktuell eingeloggten User aus der DB.
// Throws wenn nicht eingeloggt — der Middleware-Guard sorgt aber dafuer
// dass diese Funktion nur in Auth-protected Routes erreicht wird.
export async function getCurrentUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    throw new Error("Not authenticated");
  }
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: session.user?.name ?? undefined, image: session.user?.image ?? undefined },
    create: { email, name: session.user?.name ?? null, image: session.user?.image ?? null },
  });
  return user;
}
