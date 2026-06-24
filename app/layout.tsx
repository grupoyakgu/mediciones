import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yakgu Project Manager",
  description: "Financial project manager by Grupo Yakgu",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
