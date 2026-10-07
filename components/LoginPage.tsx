import React, { useState } from "react";
import { LocalizedTree } from './LocalizedTree';
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useAuth } from "./AuthProvider";
import type { AuthResult } from "./AuthProvider";
import { trackEvent } from "../lib/analytics";
import { DEMO_WORKSPACE_ENABLED } from "../lib/siteConfig";
import { getHomePathForRole } from "../types";

const inputCls =
  "h-14 rounded-[1.2rem] border border-black/[0.08] bg-[#f4f1ea] px-4 text-[15px] text-[#171512] shadow-none placeholder:text-[#8a8276] focus-visible:border-black/25 focus-visible:bg-white focus-visible:ring-0";
const labelCls = "block text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#777062]";

export const LoginPage: React.FC = () => {
  const { currentUser, loading, login, loginDemo } = useAuth();
  const location = useLocation();
  const fromPath = (location.state as { from?: { pathname?: string } })?.from?.pathname;
  const showDemoWorkspace = DEMO_WORKSPACE_ENABLED && new URLSearchParams(location.search).get("admin") === "pogi";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const withTimeout = async <T,>(promise: Promise<T>, ms = 15000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("Sign in timed out. Please try again."));
      }, ms);
      promise
        .then((value) => {
          window.clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((err) => {
          window.clearTimeout(timeoutId);
          reject(err);
        });
    });

  // Once auth state is resolved and user is logged in, redirect
  if (!loading && currentUser) {
    const destination = currentUser.role === "platform_admin"
      ? "/platform"
      : fromPath ?? getHomePathForRole(currentUser.role);
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await withTimeout<AuthResult>(login(email, password));
      if ("error" in result) {
        setError(result.error);
      } else {
        trackEvent("Login Success", { role: result.user?.role ?? "owner" });
      }
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setBusy(false);
    }
    // Redirect is handled automatically when currentUser becomes set
  };

  const handleDemo = async () => {
    setBusy(true);
    setError("");
    try {
      await withTimeout(loginDemo());
    } catch {
      setError("Unable to sign in to demo right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const isSubmitting = busy;
  const isDisabled = busy || loading;

  return (
    <LocalizedTree>
    <AuthSplitLayout
      title="Welcome back"
      subtitle="Log in to run campaigns, issue digital cards, and track loyalty activity from one place."
      badge="Sign in"
      mode="login"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <p className="text-sm leading-6 text-[#6d6658]">
          Owner access only. Staff members should continue using their dedicated portal link and PIN.
        </p>

        <div className="space-y-1.5">
          <label className={labelCls}>Email</label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@brand.com"
            className={inputCls}
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Password</label>
            <Link
              to="/forgot-password"
              className="text-[11px] text-[#6e6e73] underline-offset-2 hover:underline hover:text-[#1d1d1f]"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className={inputCls}
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="rounded-[1.2rem] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={isDisabled}
          className="h-14 w-full rounded-[1.2rem] bg-[#1b1813] text-base font-semibold text-white shadow-none hover:bg-[#11100d] disabled:opacity-60"
        >
          {isSubmitting ? "Signing in..." : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
        </Button>
        {loading && !busy && (
          <p className="text-center text-xs text-[#777062]">Checking existing session...</p>
        )}

        <p className="text-center text-sm text-[#6d6658]">
          New to Stampfy? <Link to="/signup" className="font-semibold text-[#1d1d1f] underline-offset-2 hover:underline">Create a business account</Link>
        </p>

        {showDemoWorkspace && (
          <>
            <div className="relative py-1">
              <div className="border-t border-black/[0.08]" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777062]">
                or
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              disabled={isDisabled}
              className="h-14 w-full rounded-[1.2rem] border-black/[0.08] bg-white text-base font-semibold text-[#171512] shadow-none hover:bg-[#f8f5ef]"
              onClick={handleDemo}
            >
              Try Demo Workspace
            </Button>
          </>
        )}
      </form>
    </AuthSplitLayout>
    </LocalizedTree>
  );
};
