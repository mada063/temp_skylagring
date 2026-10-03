"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Cloud, Loader2 } from "lucide-react";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
 const router = useRouter();
 const params = useSearchParams();
 const isRegister = mode === "register";

 const [name, setName] = useState("");
 const [email, setEmail] = useState("");
 const [password, setPassword] = useState("");
 const [error, setError] = useState<string | null>(null);
 const [loading, setLoading] = useState(false);

 async function onSubmit(e: React.FormEvent) {
 e.preventDefault();
 setError(null);
 setLoading(true);
 try {
 const res = await fetch(`/api/auth/${mode}`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(
 isRegister ? { name, email, password } : { email, password },
 ),
 });
 const json = await res.json();
 if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
 const next = params.get("next") || "/drive";
 router.replace(next);
 router.refresh();
 } catch (err) {
 setError(err instanceof Error ? err.message : "Something went wrong.");
 } finally {
 setLoading(false);
 }
 }

 return (
 <div className="flex min-h-screen items-center justify-center bg-bg px-4">
 <div className="w-full max-w-sm">
 <div className="mb-8 flex items-center gap-2.5">
 <div className="flex h-10 w-10 items-center justify-center bg-accent">
 <Cloud className="h-5 w-5 text-accent-fg" />
 </div>
 <span className="font-serif text-xl font-semibold tracking-tight">
 Skylagring
 </span>
 </div>

 <h1 className="mb-1 font-serif text-2xl font-semibold">
 {isRegister ? "Create your account" : "Welcome back"}
 </h1>
 <p className="mb-6 text-sm text-muted">
 {isRegister
 ? "Start storing your files in the cloud."
 : "Sign in to access your files."}
 </p>

 <form onSubmit={onSubmit} className="space-y-3">
 {isRegister && (
 <div>
 <label className="mb-1.5 block text-sm text-muted">Name</label>
 <input
 className="input"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="Your name"
 autoComplete="name"
 />
 </div>
 )}
 <div>
 <label className="mb-1.5 block text-sm text-muted">Email</label>
 <input
 className="input"
 type="email"
 required
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 placeholder="you@example.com"
 autoComplete="email"
 />
 </div>
 <div>
 <label className="mb-1.5 block text-sm text-muted">Password</label>
 <input
 className="input"
 type="password"
 required
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 placeholder={isRegister ? "At least 8 characters" : "••••••••"}
 autoComplete={isRegister ? "new-password" : "current-password"}
 />
 </div>

 {error && (
 <p className="border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
 {error}
 </p>
 )}

 <button type="submit" className="btn-primary w-full" disabled={loading}>
 {loading && <Loader2 className="h-4 w-4 animate-spin" />}
 {isRegister ? "Create account" : "Sign in"}
 </button>
 </form>

 <p className="mt-6 text-center text-sm text-muted">
 {isRegister ? "Already have an account? " : "Don't have an account? "}
 <Link
 href={isRegister ? "/login" : "/register"}
 className="text-accent hover:underline"
 >
 {isRegister ? "Sign in" : "Sign up"}
 </Link>
 </p>
 </div>
 </div>
 );
}
