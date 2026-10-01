# Route Photo Pack

Turn a route and a folder of geotagged inspection photos into a ready-to-share handoff. Useful for road, pipeline, power-line and other linear asset inspections.

[Open the working example](https://tianchaodaxing-beep.github.io/pandao-route-photo-pack/) · [Release and downloads](https://github.com/tianchaodaxing-beep/pandao-route-photo-pack/releases/tag/v0.1.0)

Supply one route and the photos you already took. The packet contains station-named photo copies, a printable photo register, a photo location list, intervals without photos, a review list and GeoJSON for your GIS. Source photos remain unchanged.

## In the browser

1. Select one GeoJSON route and a batch of JPEG photos.
2. Set the starting station, distance limit and photo coverage interval.
3. Build and download the photo packet.
4. Extract the ZIP and open `index.html`. Use your browser's Print command to save the photo register as a PDF.

Files are processed locally in your browser. There is no account, API key or server upload. The example uses nine illustrative images with simulated GPS, including an ambiguous route crossing, a distant photo and a photo without GPS.

## Run a folder

Requires Node.js 22 or later. There are no runtime dependencies.

```sh
npm install -g ./pandao-route-photo-pack-0.1.0.tgz
route-photo-pack --route route.geojson --photos inspection-photos --out new-packet
```

From a source download:

```sh
node bin/pack.mjs --route docs/samples/route.geojson --photos docs/samples/photos --out sample-packet
```

```sh
route-photo-pack --route alignment.geojson --photos day-01 --out day-01-packet --start-m 12000 --offset-m 30 --interval-m 100
```

Only JPEG files directly inside the selected folder are included. The output folder must be new. A successful command prints the actual output location, located photo count, review count and empty interval count. Input or processing failures return a nonzero exit code.

## Your route

Export one continuous **WGS84 LineString** from your GIS as GeoJSON. Coordinate order is longitude, latitude. A geometry, Feature or single-feature FeatureCollection is accepted. MultiLineString, multiple features, legacy coordinate reference declarations and discontinuous alignments must be split or re-exported first.

For approved stationing, add `properties.stations_m`: one strictly increasing station in meters for every route vertex. These supplied stations take precedence over `--start-m`. Positions between vertices interpolate the supplied stations along that segment. Split a route at station equations or decreasing station values.

```json
{
  "type": "Feature",
  "properties": {
    "name": "North access road",
    "stations_m": [12000, 12300, 12600]
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [[-0.14, 51.5], [-0.135666, 51.5], [-0.135666, 51.502698]]
  }
}
```

Without supplied stations, stationing uses approximate surface distance along the route, from the selected starting station. This is not a replacement for an approved engineering alignment or survey measurements. GPS accuracy depends on the capture device and conditions. Left and right follow the route's vertex order.

## What needs review

- **No GPS:** the photo has no usable EXIF GPS location.
- **Unreadable location:** the JPEG or its location metadata cannot be read.
- **Too far from route:** the closest route position exceeds the chosen distance limit.
- **Multiple positions:** two nearby route sections can match the photo at materially different stations. Crossings and parallel or returning sections need a location decision.

Those photos are copied into `review/`. Suggested locations are kept separate from assigned stations. They are not counted as located coverage. Keep them in the packet and confirm their locations against your field notes before delivering an approved station register.

The default ambiguity tolerance is 5 m. Candidates must be at least 30 station meters apart and within the distance limit. Use `--ambiguity-m` to change the distance tolerance in the CLI.

## Inside the packet

| File | Purpose |
|---|---|
| `index.html` | Offline, printable photo register with relative image links |
| `photos/` | Located photo copies, named by station, side and a unique photo number |
| `review/` | Photos whose location needs a decision |
| `photo-register.csv` | Source names, output paths, assigned stations and location status |
| `review.csv` | Photos requiring review, with candidate stations where available |
| `coverage.csv` | Photo counts per station interval, including empty intervals |
| `inspection.geojson` | Route and original photo GPS points for GIS import |
| `report.json` | Complete location results and settings |
| `inputs/route.geojson` | Unchanged route input |
| `manifest.json` | Input and output fingerprints for file integrity checks |

Coverage means that a station interval contains at least one **located photo**. It does not prove inspection completion or defect detection. Intervals start at the route's first station, include their start and exclude their end; the final endpoint belongs to the last interval. Original camera timestamps are shown without assuming a time zone.

The packet includes original EXIF locations. Check your organization's sharing policy before sending it outside your team.

## Limits

One continuous route, up to 10,000 vertices; 1 to 1,000 JPEGs; 30 MB per photo and 250 MB per batch. Split a job exceeding 5,000,000 photo/segment comparisons. Route segments must be shorter than 100 km, and station span must be at most 1,000 km. Coverage intervals range from 10 to 10,000 meters.

HEIC, TIFF, video and photos without EXIF GPS are not automatically located. Export unsupported formats to JPEG while retaining GPS. The tool does not identify defects, infer missing coordinates or certify engineering stationing.

## Development

```sh
node --test
npm run example
```

Serve `docs/` with a local HTTP server to use the browser interface. Browser modules and workers require HTTP or HTTPS. The downloaded photo register itself works directly after ZIP extraction.

## Contact

[tianchaodaxing@gmail.com](mailto:tianchaodaxing@gmail.com)

## License

MIT. Copyright 2026 PANDAO.
