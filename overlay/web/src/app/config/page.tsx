import { ConfigForm } from "@/components/config-form";
import { ProfileForm } from "@/components/profile-form";
import { TargetingForm } from "@/components/targeting-form";

export default function ConfigPage() {
  return (
    // One container for the whole page: the form sections were rendering
    // full-bleed, which stretched every field across the window and left the
    // only <h1> stranded in the middle of the page.
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <h1 className="font-display text-2xl tracking-tight text-landing">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Your profile, what the scanner looks for, and which AI runs it — all written to files
          in your workspace.
        </p>
      </header>

      <div className="mt-10">
        <ProfileForm />
        <TargetingForm />
        <ConfigForm />
      </div>
    </div>
  );
}
