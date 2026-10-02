import { Suspense } from "react";
import SettingsNav from "@/components/SettingsNav";
import AccountSettings from "@/components/AccountSettings";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="mb-4 font-serif text-2xl font-semibold">Settings</h1>
        <Suspense>
          <SettingsNav />
        </Suspense>
        <AccountSettings />
      </div>
    </div>
  );
}
