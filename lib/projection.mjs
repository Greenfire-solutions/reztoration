// The map projection, shared by the build and the server so points land where the shapes are:
// Albers for the lower 48, with Alaska and Hawaii insets like a US atlas.
import { geoAlbers, geoConicEqualArea } from 'd3-geo';

export const proj = {
  lower48: geoAlbers().scale(1000).translate([0, 0]),
  alaska: geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65]).scale(350).translate([-307, 201]),
  hawaii: geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18]).scale(1000).translate([-205, 212]),
};

export function regionOf([lon, lat]) {
  if (lon < -129 && lat > 51) return 'alaska';
  if (lon < -150 && lat < 24) return 'hawaii';
  return 'lower48';
}

// [lon, lat] to map [x, z], rounded to a tenth of a unit.
export function project(lonlat) {
  const p = proj[regionOf(lonlat)](lonlat);
  return p ? p.map((v) => Math.round(v * 10) / 10) : null;
}
