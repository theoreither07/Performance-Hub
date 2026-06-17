// Mini-Confetti beim Abhaken einer Aufgabe.
// Verzichtet auf eigenes Canvas-Layer, nutzt canvas-confetti's globale Instanz.

export function celebrate(origin?: { x: number; y: number }) {
  if (typeof window === "undefined") return;
  // Erst beim Aufruf laden — keep bundle klein
  import("canvas-confetti")
    .then((mod) => {
      const confetti = mod.default;
      const defaults = {
        spread: 70,
        startVelocity: 35,
        ticks: 60,
        gravity: 0.9,
        scalar: 0.9,
        colors: ["#AAFF00", "#60A5FA", "#A78BFA", "#ffffff"],
        disableForReducedMotion: true,
      };
      confetti({
        ...defaults,
        particleCount: 40,
        origin: origin
          ? { x: origin.x / window.innerWidth, y: origin.y / window.innerHeight }
          : { x: 0.5, y: 0.5 },
      });
    })
    .catch(() => {});
}

export function celebrateBig() {
  if (typeof window === "undefined") return;
  import("canvas-confetti")
    .then((mod) => {
      const confetti = mod.default;
      const end = Date.now() + 800;
      const tick = () => {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ["#AAFF00", "#60A5FA", "#A78BFA"],
          disableForReducedMotion: true,
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ["#AAFF00", "#60A5FA", "#A78BFA"],
          disableForReducedMotion: true,
        });
        if (Date.now() < end) requestAnimationFrame(tick);
      };
      tick();
    })
    .catch(() => {});
}
