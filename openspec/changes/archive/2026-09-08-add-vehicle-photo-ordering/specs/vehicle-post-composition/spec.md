## MODIFIED Requirements

### Requirement: La publicación es un carrusel con las fotos del vehículo

La publicación SHALL llevar las imágenes del vehículo agrupadas en una sola entrada, **en el orden que definió quien ordenó las fotos del vehículo**, y SHALL respetar el máximo de elementos que acepta **la red de destino**.

Cuando el vehículo tenga más fotos que ese máximo, se SHALL tomar las primeras de ese orden y descartar el resto, sin impedir la publicación. El descarte NO SHALL leerse como un efecto del orden de subida: es la consecuencia de una decisión deliberada sobre qué fotos van primero. Ver `vehicle-photo-ordering`.

El máximo NO SHALL ser un valor único del sistema: cada red fija el suyo y lo cambia por su cuenta.

#### Scenario: Vehículo con varias fotos

- **WHEN** se prepara la publicación de un vehículo con varias imágenes
- **THEN** todas van en una misma entrada, en el orden definido para el vehículo

#### Scenario: Vehículo con más fotos de las que acepta la red

- **WHEN** el vehículo tiene más imágenes que el máximo admitido por la red de destino
- **THEN** la publicación se arma con las primeras de ese orden hasta ese máximo, y las restantes se omiten

#### Scenario: Redes con máximos distintos

- **WHEN** un vehículo tiene más fotos de las que acepta una red pero no más de las que acepta la otra
- **THEN** cada publicación se arma con las fotos que su red admite, sin recortar la que no lo necesita

#### Scenario: Vehículo con una sola foto

- **WHEN** el vehículo tiene exactamente una imagen
- **THEN** la publicación se arma igual con esa única imagen

#### Scenario: Se reordenan las fotos de un vehículo con publicaciones pendientes

- **WHEN** cambia el orden de las fotos de un vehículo que tiene publicaciones pendientes
- **THEN** cada pendiente se rearma con el orden nuevo, respetando el máximo de su propia red
