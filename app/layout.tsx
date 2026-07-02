import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "台灣即時氣象地圖",
  description: "中央氣象署開放資料即時視覺化地圖（類 Windy 風格）",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body className="bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
