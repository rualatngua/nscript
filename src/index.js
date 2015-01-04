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
 * Runs a function using nscript. Params will be aliased @see nscript.alias based on their name, except for the first one, which will be replaced by nscript itself.
 * @param  {function} func
 */
var runNscriptFunction = module.exports = function(func) {
	//parse and args

	if (typeof func !== "function")
		throw "Not a function: " + func + ", the script file should be in the form 'module.exports = function(shell) { }'";
	var args = utils.extractFunctionArgumentNames(func);
	args = injectArguments(args, [].concat(scriptArgs));
	args[0] = shell;
	//invoke
	new Fiber(function() {
		func.apply(null, args);
		if (shell.verbose())
			console.log("Finished in " + process.uptime() + " seconds");
	}).run();
};

/*
 * Local imports after defining module.exports
 */
var shell = require('./shell.js');
var repl = require('./repl.js');
var scriptArgs = process.argv.slice(2); //remove node, scriptfile

var injectArguments = runNscriptFunction.injectArguments = function(argNames, varArgs) {
	var argValues = new Array(argNames.length);
	var secondPass = false;
	var validOptions = [];
	var argsRequired = -1;

	//TODO: support predefined --verbose --change-dir --help --version
	function onArg(argName, index) {
		var idxMatch = argName.match(/^\$(\d+)$/);
		var paramMatch = argName.match(/^\$\$([A-Za-z0-9_-]+)$/);
		var flagMatch = argName.match(/^\$([A-Za-z0-9_-]+)$/);
		var paramName, idx;

		//always pass in shell as first
		if (index === 0) {
			if (secondPass)
				argValues[index] = shell;
		}
		//$args returns all remaining args
		else if (argName === "$args") {
			if (secondPass)
				argValues[index] = varArgs;
		}
		//$3 returns the 3th vararg
		else if (idxMatch) {
			if (secondPass)
				argValues[index] = varArgs[idxMatch[1]];
			else
				argsRequired = Math.max(argsRequired, idxMatch[1]);
		}
		//$$myArg should parse --my-arg value
		else if (paramMatch) {
			if (!secondPass) {
				paramName = utils.hyphenate(paramMatch[1]);
				validOptions.push(paramName + " [value]");
				idx = varArgs.indexOf(paramName);
				if (idx != -1) {
					argValues[index] = varArgs[idx + 1];
					varArgs.splice(idx, 2);
				}
			}
		}
		//$myFlag should parse --my-flag to true
		else if (flagMatch) {
			if (!secondPass) {
				paramName = utils.hyphenate(flagMatch[1]);
				validOptions.push(paramName);
				idx = varArgs.indexOf(paramName);
				argValues[index] = idx != -1;
				if (idx != -1)
					varArgs.splice(idx, 1);
			}
		}
		else if (argName.indexOf('$') === 0)
			throw "Invalid parametername in nscript function: '" + argName + "', please check the nscript docs for valid parameter names";
		else if (secondPass)
			argValues[index] = shell.alias(argName);
	}

	varArgs = utils.normalizeCliFlags(varArgs);

	//parse all params and flags
	argNames.forEach(onArg);
	//remaining values should not be flags
	varArgs.forEach(function(arg) {
		//script variadic argument values should not start with a hyphen. Rly? yeah, try to touch or git add a file named '-p' for exampe :-P
		if (arg.indexOf("-") === 0)
			throw "Invalid option '" + arg + "'. Valid options are: " + validOptions.join(", ");
	});
	if (varArgs.length <= argsRequired)
		throw "Missing arguments. Expected at least " + (argsRequired + 1) + " argument(s), found: '" + varArgs.join(' ') + "'";
	//variadic arguments can only be determined reliable after parsing the named args
	secondPass = true;
	argNames.forEach(onArg);

	return argValues;
};

/**
 * Runs a file that contains a nscript script
 * @param  {string} scriptFile
 */
function runScriptFile(scriptFile)  {
	//node gets the node arguments, the nscript arguments and the actual script args combined. Slice all node and nscript args away!
	scriptArgs = scriptArgs.slice(scriptArgs.indexOf(scriptFile) + 1);
	if (shell.verbose())
		console.log("Starting nscript " + scriptFile + scriptArgs.join(" "));

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
		.usage('[options] <file>')
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
		var script = program.args[0];
		runScriptFile(script);
	}
	else {
		shell.useGlobals();
		repl.start();
	}
}