import { SubNav } from "./subnav";

export default function EfinLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav />
      {children}
    </>
  );
}
