/**
 * THE FIRST LOGIN ON A NEW SERVER (docs/SELF_HOSTING.md, 3 November 2026).
 *
 * Kuwick has no sign-up page: the platform admin (the system owner, who
 * creates clinics in the platform console) has to exist before anybody can
 * log in. This makes that one account. It refuses if the email is already an
 * admin, so it can never reset somebody's password by accident.
 *
 * The password is read from the environment and never printed; only its
 * bcrypt hash is stored.
 *
 *   DATABASE_URL=<owner URL> ADMIN_EMAIL=you@clinic.my ADMIN_NAME="Your Name" \
 *   ADMIN_PASSWORD='…at least 12 characters…' npx tsx prisma/create-platform-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const fullName = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!url || !email || !fullName) throw new Error('DATABASE_URL, ADMIN_EMAIL and ADMIN_NAME are required.');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (await prisma.platformAdmin.findUnique({ where: { email } })) {
      throw new Error(`${email} is already a platform admin. Nothing changed.`);
    }
    await prisma.platformAdmin.create({ data: { email, fullName, passwordHash: await bcrypt.hash(password, 10), active: true } });
    console.log(`Platform admin ${email} created. Log in on the web app, then create the first clinic in the platform console.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
