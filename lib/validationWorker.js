importScripts('sugarValidatorLib.js');

onmessage = (event) => {
    const { fileData, CSS, localStorage } = event.data;
    const results = validate(fileData, CSS, localStorage);
    postMessage(results);
}
