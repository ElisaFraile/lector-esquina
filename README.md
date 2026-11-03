# Lector Esquina

Lector de libros electrónicos para Windows que vive en una ventanita discreta en una esquina de la pantalla.

- Lee **MOBI**, **AZW3**, **EPUB**, **FB2**, **PDF** y **TXT**.
- Los **PDF** (y TXT) se convierten automáticamente a texto fluido para poder cambiar el tamaño de letra, igual que en un MOBI.
- **Exporta** el libro abierto a **EPUB** o **MOBI**, por ejemplo para pasar un PDF a tu Kindle.
- Ventana **sin marco** que puedes **mover**, **redimensionar** hasta un tamaño mínimo (90 × 40 px) y **anclar siempre encima** de las demás.
- **Opacidad** ajustable.
- **Modo discreto**: un atajo global (por defecto `Ctrl + Alt + L`) oculta y muestra la ventana desde cualquier programa. `Esc` también la oculta.
- Recuerda el **tamaño y la posición** de la ventana, el **libro abierto** y **por dónde ibas** en cada libro.
- Dos modos de avance para probar: **por páginas** (clic, flechas o rueda) o **scroll continuo**, más un **avance automático** opcional.
- **Color de la página**: blanco, sepia, gris, oscuro, negro o automático (sigue el modo claro/oscuro de Windows). Se cambia al momento con el botón ◐ de la barra, la tecla `T` (recorre los colores) o `D` (alterna claro/oscuro).
- Tamaño y tipo de letra, interlineado y márgenes.
- La barra superior se oculta sola cuando el ratón no está encima.

> Los libros comprados en la tienda de Kindle suelen llevar DRM (protección anticopia) y no se pueden abrir con esta app ni con ninguna otra de terceros.

## Instalar en Windows

1. Ve a la pestaña **Actions** del repositorio, abre la última ejecución correcta de «Crear instalador» y descarga el artefacto **LectorEsquina-Windows**. Si se ha publicado una versión, también lo encontrarás en **Releases**.
2. Descomprime el zip y ejecuta `LectorEsquina-Setup-x.y.z.exe`.
3. Como el instalador no está firmado digitalmente, Windows puede mostrar el aviso «Windows protegió su PC». Pulsa **Más información → Ejecutar de todas formas**.

## Uso

| Acción | Cómo |
|---|---|
| Abrir un libro | Arrástralo a la ventana, o pulsa el icono de la carpeta o `Ctrl+O` |
| Pasar página | Clic en el texto (el tercio izquierdo retrocede), `→` `←`, `Espacio` o la rueda del ratón |
| Tamaño de letra | Botones `A−` `A+` o las teclas `+` y `−` |
| Color de la página | Botón ◐ (clic derecho: claro/oscuro), tecla `T` (siguiente color) o `D` (claro/oscuro) |
| Ajustes | Botón ☰ o tecla `M` |
| Pausar el avance automático | Tecla `P` o el botón ▶/❚❚ |
| Ocultar la ventana | `Esc`, el botón `—` o el atajo global |
| Volver a mostrarla | El atajo global (`Ctrl+Alt+L`) o clic en el icono de la bandeja del sistema |
| Mover la ventana | Arrástrala desde la barra superior |
| Redimensionar | Arrastra un borde o una esquina |

El atajo global se cambia en **Ajustes → Ventana**. Si la ventana se pierde fuera de la pantalla, usa **Volver a la esquina** en los ajustes o en el menú del icono de la bandeja.

Los libros se copian en la carpeta de datos de la app (`%APPDATA%\Lector Esquina\libros`), así que el original puede moverse o borrarse sin problema. **Quitar libro** borra esa copia, pero conserva por dónde ibas por si lo vuelves a abrir.

## Desarrollo

Requiere [Node.js](https://nodejs.org) 22 o posterior.

```bash
npm install
npm start          # abre la app en modo desarrollo
npm test           # pruebas de los conversores EPUB y MOBI
npm run dist:win   # crea el instalador de Windows (en Windows) en dist/
```

Cada vez que se sube código a `main`, GitHub Actions crea el instalador de Windows. Para publicar una versión con su instalador en **Releases**:

```bash
npm version patch
git push --follow-tags
```

### Estructura

```
src/main/           proceso principal de Electron (ventana, bandeja, atajo, biblioteca)
src/renderer/       interfaz del lector
  app.js            lógica del lector
  convert/          conversores: PDF y TXT → libro, libro → EPUB y MOBI
  vendor/           foliate-js (motor de lectura, MIT), pdf.js y fflate
build/              iconos
test/               pruebas
```

## Licencias

Código de la app: MIT. Incluye [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), [pdf.js](https://github.com/mozilla/pdf.js) (Apache 2.0) y [fflate](https://github.com/101arrowz/fflate) (MIT).
