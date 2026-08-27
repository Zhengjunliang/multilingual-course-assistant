import { useContext } from "react";

import { SessionContext } from "./SessionProvider";

export function useSession() {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession needs a SessionProvider above it");
  return value;
}
