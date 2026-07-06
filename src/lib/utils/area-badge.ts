import type { LifeArea } from "@/types/domain";

export const AREA_BADGE_VARIANT: Record<LifeArea, "priv" | "fh" | "biz"> = {
  PRIVATE: "priv",
  FH: "fh",
  BUSINESS: "biz",
};

export const AREA_LABEL: Record<LifeArea, string> = {
  PRIVATE: "Privat",
  FH: "FH",
  BUSINESS: "Business",
};
