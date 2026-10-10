"use client";

import { createContext, useContext } from "react";

export const SearchQueryContext = createContext<string>("");

export function useSearchQuery(): string {
  return useContext(SearchQueryContext);
}
