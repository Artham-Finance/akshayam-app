import { SettingsTabs } from "@/components/SettingsTabs";
import { can, requireUser } from "@/lib/auth/dal";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // Settings as a whole needs a signed-in user; each page below asserts the
  // particular permission it needs.
  await requireUser();
  return (
    <div>
      <SettingsTabs canManageUsers={await can("users.manage")} />
      {children}
    </div>
  );
}
