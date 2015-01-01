#!/usr/bin/env node
/*
 * nscript: javascript shell scripts for the masses
 *
 * (c) 2014 - Michel Weststrate
 */
/* GLOBAL exports,module */

var Fiber = require('fibers');
var path = require('path');
var utils = require('./utils.js');
var program = require('commander');
var fs = require('fs');

/**
 * Runs a function using nscript. Params will be wrapped @see nscript.wrap based on their name, except for the first one, which will be replaced by nscript itself.
 * @param  {function} func
 */
var runNscriptFunction = module.exports = function(func) {
	//parse and args

	if (typeof func !== "function")
		throw "Not a function: " + func + ", the script file should be in the form 'module.exports = function(shell) { }'";
	var args = utils.extractFunctionArgumentNames(func);
	args.map(shell.wrap);
	args[0] = shell;
	//invoke
	new Fiber(function() {
		func.apply(null, args);
		if (shell.verbose())
			console.log("Finished in " + process.uptime() + " seconds");
	}).run();
}

/*
 * Local imports after defining module.exports
 */
var shell = require('./shell.js');
var repl = require('./repl.js');

/**
 * Runs a file that contains a nscript script
 * @param  {string} scriptFile
 */
function runScriptFile(scriptFile)  {
	runNscriptFunction(require(path.resolve(process.cwd(), scriptFile))); //nscript scripts should always export a single function that is the main
}

function touchScript(scriptFile, local) {
	if (fs.existsSync(scriptFile))
		throw "File '" + scriptFile + "' already exists";
	console.log("Generating default script in '" + scriptFile + "' " + (local?"[using local nscript]":""))
	var demoFunc =
		"function(shell, echo) {\n" +
		"\t//generated by 'nscript', see the docs at https://github.com/mweststrate/nscript"
		"\tshell.verbose(true)			//print debug info\n" +
		"\techo(\"hello\", \"world\")	//use 'echo' alias\n" +
		"\tshell(\"whoami\")			//run any command from 'shell'\n"
		"}";
	fs.writeFileSync(
		scriptFile,
		local ? "require(nscript)(" + demoFunc + ")" : "module.exports = " + demoFunc,
		"utf8"
	);
	makeExecutable(scriptFile, local);
}

function makeExecutable(scriptFile, local) {
	if (!fs.existsSync(scriptFile))
		throw "Filed doesn't exist: " + scriptFile;
	if (process.platform === 'windows') {
		console.log("Generating executable script in '" + scriptFile + ".bat' " + (local?"[using local nscript]":""))
		shell.writeTo(scriptFile + ".bat", (local ? "node " : "nscript ") + path.basename(scriptFile) + " %+");
	}
	else {
		console.log("Marking script as executable: '" + scriptFile + "' " + (local?"[using local nscript]":""))
		shell.nscript(function(shell, cp, chmod, rm, echo, cat) {
			cp(scriptFile, scriptFile + ".bak");
			echo.writeTo(local ? "#!/usr/bin/env node" : "#!/usr/bin/nscript", scriptFile);
			cat.appendTo(scriptFile + ".bak", scriptFile);
			chmod("+x", scriptFile);
			rm(scriptFile + ".bak");
		});
	}
}

var version = exports.version = require('../package.json').version;

if (!module.parent) {
	program
		.version(version)
		.usage('[options] <files...>')
		.option('-C, --chdir <path>', 'change the working directory')
		.option('-v, --verbose', 'start in verbose mode')
		.option('--touch <path>', 'create a new nscript file at the specified location and make it executable')
		.option('-x <path>', 'make sure the nscript file at the specified location is executable')
		.option('--local', 'in combination with --touch or -x; do not use global nscript, but the one provided in the embedding npm package');

	program.parse(process.argv);

	if (program.chdir)
		shell.cd(program.chdir);
	if (program.verbose)
		shell.verbose(true);

	if (program.touch)
		touchScript(program.touch, program.local);
	else if (program.X) //MWE: unsure why X is upercased here...
		makeExecutable(program.X, program.local);
	else if (process.argv.length > 2) {
		var scripts = program.args;
		for (var i = 0; i < scripts.length; i++)
			runScriptFile(scripts[i]); //TODO: add callback and make async, runScript cannot be run parallel
	}
	else {
		shell.useGlobals();
		repl.start();
	}
}