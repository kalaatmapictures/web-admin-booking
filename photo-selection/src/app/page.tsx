import { Container } from "@/components/layout/container";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

const steps = [
  {
    title: "Buka tautan galeri",
    body: "Kalaatma mengirimkan tautan pribadi untuk sesi foto Anda. Tidak perlu membuat akun.",
  },
  {
    title: "Pilih foto favorit",
    body: "Ketuk foto untuk memilih atau membatalkan. Penghitung kuota selalu terlihat dan pilihan tersimpan otomatis.",
  },
  {
    title: "Selesaikan seleksi",
    body: "Setelah yakin, tekan Selesaikan Seleksi. Daftar kode foto langsung diterima tim editor kami.",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section>
          <Container className="py-16 sm:py-24 lg:py-32">
            <p className="text-xs font-medium tracking-[0.2em] text-muted uppercase">Kalaatma Pictures</p>
            <h1 className="mt-5 max-w-3xl font-display text-[2.6rem] leading-[1.05] font-medium tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Pilih foto favorit Anda dengan tenang.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
              Galeri online untuk memilih foto yang akan kami edit — tanpa perlu mencatat kode foto satu per satu.
            </p>

            <div className="mt-10 max-w-xl rounded-2xl border border-line bg-surface p-6 sm:p-7">
              <h2 className="text-[15px] font-semibold">Sudah menerima tautan galeri?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Buka tautan yang dikirim Kalaatma melalui WhatsApp atau email. Setiap tautan bersifat pribadi —
                mohon tidak dibagikan kepada orang lain.
              </p>
            </div>
          </Container>
        </section>

        <section className="border-t border-line bg-surface">
          <Container className="py-16 sm:py-20">
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">Cara memilih foto</h2>
            <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className="font-display text-2xl text-muted lining-nums tabular-nums">0{index + 1}</span>
                  <h3 className="mt-3 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
