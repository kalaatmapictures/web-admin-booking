import Link from "next/link";

/** Logo Kalaatma (huruf K dengan titik oranye) + nama aplikasi. */
export function Brand() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3" aria-label="Kalaatma Photo Selection — beranda">
      <span className="relative grid size-9 place-items-center rounded-[10px] bg-ink text-[17px] font-bold text-white">
        K
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">Kalaatma</span>
        <span className="block text-xs text-muted">Photo Selection</span>
      </span>
    </Link>
  );
}
