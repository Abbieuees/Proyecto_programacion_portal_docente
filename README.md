<div align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/5/50/Universidad_Evang%C3%A9lica_de_El_Salvador.png?utm_source=es.wikipedia.org&utm_campaign=index&utm_content=original" alt="Logo Institucional" width="150" height="120">

  # CARÁTULA INSTITUCIONAL

  ## **Asignatura:** Programación web 
  ### **Docente:** Ricardo Ernesto Alvarado Martinez 
  ### **Ciclo:** 02-2026

  ---

  ### INTEGRANTES DEL EQUIPO

  | Nombre Completo | CIF |
  | :--- | :---: |
  | Abbie Elena Córdova Cortez | `2025010212` |
  | Edgar Josué Hernández González | `2025011349` |
  | Jacqueline Alicia Bolaños Ramos | `2025010375` |
  ---
</div>

## 1. Resumen Ejecutivo (Propuesta de Rediseño)

Nuestra propuesta de Rediseño se basa en identificar el problema, proponer una solución y obtener beneficios para el desarrollo de nuestro proyecto. 

* **Problema detectado:** El diseño presenta muchos puntos de mejora, principalmente en cuestión de color y contraste en el cual no se cumple lo exigido por WCAG AA y así mismo el diseño está visualmente saturado por la cantidad de elementos agrupados en su mayoría al lado izquierdo del portal actual, como también las variaciones entre tipografías y sus tamaños se vuelven ilegibles y no presentan ninguna jerarquía.
* **Solución propuesta:** Empezamos con la creación de una paleta de colores basada en la identidad corporativa de la Universidad que cumple con lo exigido por WCAG AA, luego implementamos un diseño de vistas donde se cumpla un diseño atractivo, limpio y que no está saturado o sobrecargado de elementos.
* **Beneficios clave:** Con este rediseño logramos mayor rapidez, mejor orden visual, facilidad de uso, responsividad.

---

## 2. Instrucciones de Visualización y Ejecución

Guía paso a paso para que el docente o cualquier persona pueda abrir y probar el proyecto.

### Requisitos Previos
* [Node.js](https://nodejs.org) 20 o superior (versión LTS) para ejecutar el backend.
* Un navegador web actualizado (Chrome, Edge, Firefox o Safari).
* Conexión a internet para cargar la tipografía (Google Fonts) y los íconos (Bootstrap Icons).
* Opcional: Visual Studio Code con las extensiones **Live Server** y **REST Client**.

### Pasos para la Ejecución

1. **Descargar el proyecto:** Clona el repositorio o descarga la carpeta en tu computadora.
```bash
   git clone https://github.com/Abbieuees/proyecto-portal-docente-uees
```

2. **Entrar a la carpeta:**
```bash
   cd proyecto-portal-docente-uees
```

3. **Instalar e iniciar el backend** (la primera vez se ejecuta `npm install`):
```bash
   cd backend
   npm install
   npm start
```

4. **Abrir el portal:** entra a **http://localhost:3000** en el navegador. También funciona con Live Server, siempre que el backend esté en ejecución.

5. **Credenciales de prueba:**

   | Usuario | Contraseña |
   | :--- | :--- |
   | `docente@uees.edu.sv` | `Docente2026` |

6. **Navegación:**
   * `index.html` — Inicio de sesión del docente (valida el usuario contra la API).
   * `portal-docente.html` — Panel principal: asignaturas, selección de evaluación, carga y traslado de calificaciones, historial, perfil y ayuda.

> **Nota:** El backend es una **API REST simulada**: guarda los datos en memoria con la misma estructura de la base de datos, así que los cambios se pierden al reiniciar el servidor. El script `docs/script_base_datos.sql` contiene el modelo relacional completo en PostgreSQL con datos de prueba.

---

## 3. Backend: API REST simulada

### ¿Por qué Node.js + Express?
* **Un solo lenguaje en todo el proyecto:** el frontend ya está en JavaScript. Las reglas de las notas (`src/js/reglas.js`) las usan el navegador y el servidor sin duplicar código.
* **Liviano y muy usado para APIs REST:** Express trabaja con JSON de forma natural y tiene abundante documentación y ejemplos en español.
* **Conexión directa con PostgreSQL** mediante el paquete `pg`, cuando se reemplace la simulación por la base de datos real.

### Estructura
```
backend/
├── server.js        Arranque: JSON, CORS, latencia simulada, rutas, frontend y errores
├── datos.js         Base de datos simulada (mismas tablas y columnas que el script SQL)
├── repositorio.js   Única capa que accede a los datos; cada función indica su consulta SQL
├── rutas/           Endpoints por recurso: auth, perfil, grupos, evaluaciones, historial
├── sesiones.js      Tokens de sesión y middleware requireAuth
├── seguridad.js     Hash de contraseñas con scrypt (módulo crypto de Node)
├── acceso.js        Comprueba que cada grupo y evaluación sea del docente de la sesión
├── api.http         Peticiones de ejemplo para la extensión REST Client
└── test/            Pruebas automáticas (npm test)
```

### Endpoints
Todas las rutas, excepto el login, requieren la cabecera `Authorization: Bearer <token>`.

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Inicia sesión y devuelve el token. `{ correo, contrasena, recordar }` |
| `POST` | `/api/auth/logout` | Cierra la sesión (invalida el token) |
| `GET` | `/api/perfil` | Datos del docente |
| `PUT` | `/api/perfil/contrasena` | Cambia la contraseña. `{ actual, nueva }` |
| `GET` | `/api/grupos` | Grupos del docente, con su total de estudiantes |
| `GET` | `/api/grupos/:id` | Detalle de un grupo |
| `GET` | `/api/grupos/:id/estudiantes` | Nómina del grupo |
| `GET` | `/api/grupos/:id/evaluaciones?tipo=` | Evaluaciones del grupo; filtro opcional `TAREA`, `PARCIAL` o `PROYECTO` |
| `GET` | `/api/evaluaciones/:id` | Detalle de una evaluación |
| `GET` | `/api/evaluaciones/:id/calificaciones` | Estudiantes con su nota (`null` = pendiente) |
| `PUT` | `/api/evaluaciones/:id/calificaciones` | Guarda notas. `{ calificaciones: [{ id_matricula, nota }] }` |
| `POST` | `/api/evaluaciones/:id/traslado` | Traslada la evaluación (exige todas las notas) |
| `GET` | `/api/historial` | Evaluaciones trasladadas con promedio, aprobados y reprobados |

### Respuestas de error
Los errores siempre llegan en JSON: `{ "error": "mensaje" }`.

| Código | Cuándo ocurre |
| :--- | :--- |
| `400` | Datos inválidos: nota fuera de rango, más de 2 decimales, JSON mal formado… (nunca se guarda una parte de la lista) |
| `401` | Sin token, token vencido o credenciales incorrectas |
| `403` | El grupo o la evaluación pertenece a otro docente |
| `404` | El recurso o la ruta no existe |
| `409` | La evaluación ya fue trasladada, o faltan notas para trasladarla |

### Pruebas
* `npm test` ejecuta las pruebas automáticas de `backend/test/` (login, permisos, validación de notas, traslado, historial y cambio de contraseña).
* `backend/api.http` permite probar cada endpoint desde VS Code con la extensión **REST Client**.
* `npm run dev` reinicia el servidor al guardar cambios. La variable `LATENCIA_MS` ajusta el retraso simulado de la red (300 ms por defecto; `0` para quitarlo).

### Cómo pasar a PostgreSQL
1. Crear la base de datos con `docs/script_base_datos.sql`.
2. Instalar el conector: `npm install pg`.
3. Reemplazar el cuerpo de cada función de `repositorio.js` por la consulta SQL que tiene comentada encima. Las rutas y el frontend no cambian, porque todas las funciones ya son asíncronas.

---

## 4. Historial de Commits Significativos

A continuación se detallan los aportes y cambios más importantes registrados en el sistema de control de versiones por cada miembro del equipo.

### Abbie Elena Córdova Cortez
* **`feat: estructura inicial y carpeta docs`** - Creó las carpetas principales y agregó la carpeta docs.

### Edgar Josué Hernández González
* **`feat: agrego los archvios index y el readme`** - Agregó index.html, portal-docente.html y el README del repositorio.

### Jacqueline Alicia Bolaños Ramos
* _Pendiente: agregar sus commits significativos._
