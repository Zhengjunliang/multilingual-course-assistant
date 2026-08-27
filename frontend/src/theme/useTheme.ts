import { useContext } from "react";

import { ThemeContext } from "./ThemeProvider";

export function useTheme() {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme needs a ThemeProvider above it");
  return value;
}
