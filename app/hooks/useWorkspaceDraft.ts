import { useState } from "react";

// A draft belongs to its case/mailbox. Navigation never transfers it to another sender.
export function useWorkspaceDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof sessionStorage === "undefined") return initial;
    try {
      return (
        JSON.parse(sessionStorage.getItem(`inbox-draft:${key}`) || "null") ??
        initial
      );
    } catch {
      return initial;
    }
  });
  const save = (next: T) => {
    setValue(next);
    try {
      sessionStorage.setItem(`inbox-draft:${key}`, JSON.stringify(next));
    } catch {
      /* Session remains usable when storage is unavailable. */
    }
  };
  return [value, save] as const;
}
