"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Check } from "lucide-react";

type Me = { email: string; name: string | null; image: string | null };

export default function ProfileSettings() {
 const router = useRouter();
 const fileRef = useRef<HTMLInputElement>(null);

 const [me, setMe] = useState<Me | null>(null);
 const [name, setName] = useState("");
 const [image, setImage] = useState<string | null>(null);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
 fetch("/api/me")
 .then((r) => r.json())
 .then((d) => {
 setMe(d.user);
 setName(d.user.name ?? "");
 setImage(d.user.image ?? null);
 });
 }, []);

 function onPick(e: React.ChangeEvent<HTMLInputElement>) {
 const file = e.target.files?.[0];
 e.target.value = "";
 if (!file) return;
 if (!file.type.startsWith("image/")) {
 setError("Please choose an image file.");
 return;
 }
 if (file.size > 2 * 1024 * 1024) {
 setError("Image must be under 2 MB.");
 return;
 }
 const reader = new FileReader();
 reader.onload = () => setImage(reader.result as string);
 reader.readAsDataURL(file);
 }

 async function save() {
 setSaving(true);
 setError(null);
 setSaved(false);
 const res = await fetch("/api/me", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ name, image }),
 });
 const json = await res.json();
 setSaving(false);
 if (!res.ok) {
 setError(json.error ?? "Could not save.");
 return;
 }
 setSaved(true);
 router.refresh();
 setTimeout(() => setSaved(false), 2000);
 }

 if (!me) {
 return (
 <div className="flex items-center gap-2 text-sm text-muted">
 <Loader2 className="h-4 w-4 animate-spin" /> Loading…
 </div>
 );
 }

 const initial = (name || me.email).charAt(0).toUpperCase();

 return (
 <div className="max-w-md space-y-6">
 <div className="flex items-center gap-4">
 <button
 onClick={() => fileRef.current?.click()}
 className="group relative h-20 w-20 overflow-hidden rounded-full"
 >
 {image ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={image} alt="Profile" className="h-full w-full object-cover" />
 ) : (
 <div className="flex h-full w-full items-center justify-center bg-accent text-2xl font-medium text-accent-fg">
 {initial}
 </div>
 )}
 <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
 <Camera className="h-5 w-5 text-white" />
 </div>
 </button>
 <div>
 <p className="text-sm font-medium">Profile picture</p>
 <p className="text-xs text-muted">PNG or JPG, up to 2 MB.</p>
 {image && (
 <button
 onClick={() => setImage(null)}
 className="mt-1 text-xs text-danger hover:underline"
 >
 Remove
 </button>
 )}
 </div>
 <input
 ref={fileRef}
 type="file"
 accept="image/*"
 className="hidden"
 onChange={onPick}
 />
 </div>

 <div>
 <label className="mb-1.5 block text-sm text-muted">Name</label>
 <input
 className="input"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="Your name"
 />
 </div>

 <div>
 <label className="mb-1.5 block text-sm text-muted">Email</label>
 <input className="input opacity-60" value={me.email} disabled />
 </div>

 {error && <p className="text-sm text-danger">{error}</p>}

 <button className="btn-primary" onClick={save} disabled={saving}>
 {saving ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : saved ? (
 <Check className="h-4 w-4" />
 ) : null}
 {saved ? "Saved" : "Save changes"}
 </button>
 </div>
 );
}
