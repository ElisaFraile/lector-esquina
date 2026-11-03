// Libro de ejemplo para las pruebas.
export const sampleBook = () => ({
    title: 'Libro de prueba: ñandú & «comillas»',
    author: 'Elisa',
    language: 'es',
    chapters: Array.from({ length: 4 }, (_, c) => ({
        title: `Capítulo ${c + 1}`,
        blocks: [
            { type: 'h', level: 2, runs: [{ text: `Capítulo ${c + 1}` }] },
            ...Array.from({ length: 60 }, (_, i) => ({
                type: 'p',
                runs: [{ text: `Párrafo ${i} con acentos áéíóú, eñes ñ y emojis 📚 ` }, { text: 'cursiva', i: true }, { text: ' <etiqueta> & fin.' }],
            })),
        ],
    })),
})
