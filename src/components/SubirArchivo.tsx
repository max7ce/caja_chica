import { useState } from 'react'

export function SubirArchivo({ etiqueta, onSeleccion, disabled }: {
  etiqueta: string
  onSeleccion: (archivo: File | null) => void
  disabled?: boolean
}) {
  const [nombre, setNombre] = useState<string | null>(null)
  return (
    <div className="cc-campo">
      <label>{etiqueta}</label>
      <input
        type="file" accept="image/*,application/pdf" disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          setNombre(f?.name ?? null)
          onSeleccion(f)
        }}
      />
      {nombre && <p className="cc-mono">{nombre}</p>}
    </div>
  )
}
