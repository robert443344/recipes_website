# F1 · Drift en el Malecón 🇩🇴

Simulación 3D en tiempo real de un monoplaza de Fórmula 1 haciendo **donuts, trompos y derrapes**
en el **Malecón de Santo Domingo** (Av. George Washington), República Dominicana, cerrado al tráfico
para una exhibición.

Todo es procedural: el coche, la ciudad, las palmeras, el mar y las texturas se generan con código
(no hay imágenes ni modelos 3D que descargar). Solo se usa [three.js](https://threejs.org) desde CDN.

## Cómo verlo

- **GitHub Pages:** `https://robert443344.github.io/recipes_website/f1-drift-malecon/`
  (cuando estos cambios estén en la rama publicada).
- **En local:** los módulos ES no funcionan abriendo el archivo directamente; hace falta un servidor:

  ```bash
  cd recipes_website
  python3 -m http.server 8000
  # abrir http://localhost:8000/f1-drift-malecon/
  ```

## Qué incluye

- **Monoplaza F1** con carrocería por secciones, alerones con perfil aerodinámico, halo, DRS que se abre
  en recta, discos de freno que se ponen incandescentes, luz trasera que parpadea al recuperar energía
  y decoración con los colores de la bandera dominicana.
- **Física de vehículo**: modelo de bicicleta con neumáticos no lineales, círculo de fricción, carga
  aerodinámica, transferencia de peso y patinaje de las ruedas traseras (de ahí los donuts y derrapes).
- **Modo show automático**: recta, eses derrapando, donuts, trompo de 360°, pasada a fondo con DRS,
  frenada y giro en U derrapando, en bucle por ambos sentidos del Malecón.
- **Efectos**: humo de neumáticos iluminado, marcas de goma permanentes en el asfalto, bloom, sombras
  largas del atardecer y reflejos de la pintura con el cielo.
- **Escenario**: mar Caribe con reflejos y espuma contra las rocas "diente de perro", paseo marítimo
  con balaustrada blanca, palmeras que se mueven con la brisa, farolas, el Obelisco, banderas
  dominicanas ondeando, edificios con tinacos en las azoteas, barcos en el horizonte y público.
- **Sonido sintetizado** (Web Audio): motor V6 turbo, chirrido de neumáticos, olas y público, con
  efecto Doppler en las pasadas.
- **Hora del día**: atardecer, mediodía y noche.

## Controles

| Tecla | Acción |
| --- | --- |
| `W` / `↑` | Acelerar |
| `S` / `↓` | Frenar / marcha atrás |
| `A` `D` / `←` `→` | Girar |
| `Espacio` | Freno de mano |
| `1` / `Tab` | Show automático ⇄ manual |
| `C` | Cambiar cámara (persecución, TV, helicóptero, a bordo, libre) |
| `T` | Hora del día |
| `M` | Sonido |
| `R` | Recolocar el coche |
| `B` | Borrar marcas de goma |
| `H` | Ayuda |

Truco: a baja velocidad, gas a fondo con el volante girado = donuts. Para derrapar, entra en la curva,
pisa a fondo y suelta el volante: el asistente aplica el contravolante.

### Parámetros de URL

`?cam=helicoptero&hora=noche&modo=manual&auto` — `auto` salta la pantalla de inicio.

## Estructura

```
f1-drift-malecon/
├── index.html        página, HUD e import map de three.js
├── css/style.css     estilos del HUD
└── js/
    ├── main.js       render, cámaras, controles, HUD y bucle principal
    ├── physics.js    dinámica del vehículo (sin dependencias, se puede probar en Node)
    ├── autopilot.js  coreografía del modo show
    ├── car.js        modelo 3D del monoplaza
    ├── world.js      Malecón, mar, cielo, ciudad y público
    ├── effects.js    humo y marcas de neumáticos
    ├── textures.js   texturas procedurales (canvas)
    └── audio.js      sonido sintetizado
```
