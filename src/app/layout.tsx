import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novel2Script",
  description: "A local workbench for traceable screenplay YAML generation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
