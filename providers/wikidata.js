const utils = require('../utils')
const helpers = require('@turf/helpers')
const iso639 = require('../utils/ISO_639-2_alpha-2')

 const wikidataCodes = {
  country: 'Q6256',
  province: 'Q11828004',
  capital: 'Q5119',
  city: 'Q515',
  town: 'Q3957',
  village: 'Q532',
  municipality: 'Q15284',
  suburb: 'Q188509',
  neighborhood: 'Q123705',
}

 const Options = {
  subclasses: ['Q486972'],
  languages: ['en', 'fr', 'es', 'de', 'it', 'ru'],
  radius: 15,
  sparql: false,
}

function createQuery(address, options = Options) {
  // Validation
  if (!options.nearest) { utils.error('--nearest is required') }

  // Options
  const [lng, lat] = options.nearest
  const radius = options.radius || Options.radius
  const subclasses = options.subclasses || Options.subclasses
  const languages = options.languages || Options.languages

  // Validate languages
  languages.map(language => {
    if (iso639.codes[language] === undefined) { utils.error(`wikidata language code [${language}] is invalid`) }
  })

  // Convert Arrays into Strings
  const subclassesString = subclasses.map(code => {
    const wikidata = wikidataCodes
    code = wikidata[code] || code
    return `wd:${code.replace('wd:', '')}`
  }).join(', ')

  // Build SPARQL Query
  let query = `SELECT DISTINCT ?place ?location ?distance ?placeDescription `
  query += languages.map(language => `?name_${ language }`).join(' ')
  query += ` WHERE {
  # Search Instance of & Subclasses
  ?place wdt:P31/wdt:P279* ?subclass
  FILTER (?subclass in (${ subclassesString }))
`
  if (options.nearest) {
    query += `
  # Search by Nearest
  SERVICE wikibase:around {
    ?place wdt:P625 ?location .
    bd:serviceParam wikibase:center "Point(${ lng } ${ lat })"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${ radius }" .
    bd:serviceParam wikibase:distance ?distance .
  }
`
  }
  query += `\n  # Filter by Exact Name\n`
  languages.map(language => {
    query += `  OPTIONAL {?place rdfs:label ?name_${ language } FILTER (lang(?name_${ language }) = "${ language }") . }\n`
  })

  query += `\n  FILTER (`
  query += languages.map(language => `regex(?name_${ language }, "^${ address }$")`).join(' || ')
  query += `) .\n`

  // Descriptions
  query += `
  # Get Descriptions
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "${ languages.join(',') }"
  }

} ORDER BY ASC(?distance)
`
  return query
}

/**
 * Convert Wikidata SPARQL results into GeoJSON
 */
 function toGeoJSON(json, options = Options) {
  const languages = options.languages || Options.languages
  const collection = helpers.featureCollection([])
  if (json.results !== undefined) {
    if (json.results.bindings !== undefined) {
      json.results.bindings.map(result => {
        // Standard Wikidata tags
        const id = result.place.value.match(/entity\/(.+)/)[1]
        const [lng, lat] = result.location.value.match(/\(([\-\.\d]+) ([\-\.\d]+)\)/).slice(1, 3).map(n => Number(n))
        const distance = Number(result.distance.value)
        const properties = {
          id,
          distance,
        }
        if (result.placeDescription) {
          properties.description = result.placeDescription.value
        }
        // Parse languages
        languages.map(language => {
          const match = result[`name_${ language }`]
          if (match !== undefined) {
            properties[`name:${ language }`] = match.value
          }
        })

        // Create Point
        const point = helpers.point([lng, lat], properties)
        point.id = id

        // Add to GeoJSON Feature Collection
        collection.features.push(point)
      })
    }
  }

  return collection
}

module.exports.Options = Options
module.exports.toGeoJSON = toGeoJSON