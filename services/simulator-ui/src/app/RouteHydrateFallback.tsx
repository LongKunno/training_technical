interface RouteHydrateFallbackProps {
  title: string;
  description: string;
}

export function RouteHydrateFallback({ description, title }: RouteHydrateFallbackProps) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="glass-card panel-outline surface-noise rounded-[30px] border px-5 py-6 sm:px-6 xl:px-7"
    >
      <div className="animate-pulse">
        <div className="h-3 w-28 rounded-full bg-white/10" />
        <div className="mt-4 h-10 max-w-xl rounded-full bg-white/12" />
        <div className="mt-4 h-4 max-w-2xl rounded-full bg-white/8" />
        <div className="mt-2 h-4 max-w-xl rounded-full bg-white/6" />
      </div>

      <div className="mt-6 rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
        <div className="text-sm font-medium text-white">{title}</div>
        <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-[168px] animate-pulse rounded-[24px] border border-white/8 bg-white/[0.04]"
          />
        ))}
      </div>
    </section>
  );
}
