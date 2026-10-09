/**
 * The last screen, for an error no route can catch: one thrown by a provider
 * outside the router (main.tsx), the theme or the session. A route's error is
 * always caught first, by the route (App.tsx), with the frame still standing;
 * this one has nothing standing, so it draws the same panel over the window.
 *
 * A class, as React catches render errors only in one. It reads no provider,
 * since one of them may be what failed: the words come from the i18n module
 * itself, the panel holds no state, and the way back is a plain link, as the
 * router may be gone with the rest. React reports the error to the console.
 */

import { ArrowLeft, RotateCw } from "lucide-react";
import { Component, type ReactNode } from "react";

import { StatusPanel } from "@/components/StatusPanel";
import { Button, buttonVariants } from "@/components/ui/button";
import i18n from "@/i18n";

interface AppCrashState {
  crashed: boolean;
}

export class AppCrash extends Component<{ children: ReactNode }, AppCrashState> {
  state: AppCrashState = { crashed: false };

  static getDerivedStateFromError(): AppCrashState {
    return { crashed: true };
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main className="flex min-h-full flex-col items-center justify-center px-gutter py-room">
        <StatusPanel pose="error" heading={i18n.t("crash.title")} body={i18n.t("crash.body")} alert>
          <Button type="button" onClick={() => window.location.reload()}>
            <RotateCw aria-hidden className="size-icon" />
            {i18n.t("crash.reload")}
          </Button>
          <a href="/" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden className="size-icon" />
            {i18n.t("crash.home")}
          </a>
        </StatusPanel>
      </main>
    );
  }
}
