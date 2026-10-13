import Link from "next/link";

import { Container } from "@/components/layout/container";
import { SiteHeader } from "@/components/layout/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Container className="py-24 sm:py-32">
          <p className="text-xs font-medium tracking-[0.2em] text-muted uppercase">404</p>
          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight sm:text-5xl">Halaman tidak ditemukan</h1>
          <p className="mt-4 max-w-md text-muted">
            Tautan mungkin salah ketik, sudah kedaluwarsa, atau telah dicabut. Hubungi Kalaatma bila Anda membutuhkan
            tautan baru.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-medium text-white transition-colors hover:bg-ink-soft"
          >
            Kembali ke beranda
          </Link>
        </Container>
      </main>
    </>
  );
}
