import { UploadTabs } from "@/components/UploadTabs";
import { requirePermission } from "@/lib/auth/dal";

export default async function UploadLayout({ children }: { children: React.ReactNode }) {
  // The area as a whole needs the upload capability; each page below still
  // asserts whatever else it needs on its own.
  await requirePermission("data.upload");
  return (
    <div>
      <UploadTabs />
      {children}
    </div>
  );
}
