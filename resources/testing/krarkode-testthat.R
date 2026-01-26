# Krarkode testthat reporter for VS Code Test Explorer.

krarkode_emit <- function(payload) {
  cat(jsonlite::toJSON(payload, auto_unbox = TRUE))
  cat("\n")
  flush.console()
}

krarkode_expectation_type <- function(exp) {
  stopifnot(testthat::is.expectation(exp))
  gsub("^expectation_", "", class(exp)[[1]])
}

krarkode_expectation_message <- function(exp) {
  if (krarkode_expectation_type(exp) %in% c("failure", "error", "skip")) {
    exp$message
  } else {
    NULL
  }
}

krarkode_expectation_location <- function(exp) {
  if (is.null(exp$srcref)) {
    ""
  } else {
    filename <- attr(exp$srcref, "srcfile")$filename
    if (identical(filename, "")) {
      paste0("Line ", exp$srcref[1])
    } else {
      paste0(basename(filename), ":", exp$srcref[1], ":", exp$srcref[2])
    }
  }
}

KrarkodeReporter <- R6::R6Class(
  "KrarkodeReporter",
  inherit = testthat::Reporter,
  public = list(
    selected_test = NULL,
    initialize = function(selected_test = NULL, ...) {
      super$initialize(...)
      self$selected_test <- selected_test
      self$capabilities$parallel_support <- TRUE
    },
    start_file = function(filename) {
      krarkode_emit(list(type = "start_file", filename = filename))
    },
    start_test = function(context, test) {
      if (!self$should_emit(test)) {
        return()
      }
      krarkode_emit(list(type = "start_test", test = test))
    },
    add_result = function(context, test, result) {
      if (!self$should_emit(test)) {
        return()
      }
      payload <- list(
        type = "add_result",
        test = test,
        result = krarkode_expectation_type(result),
        location = krarkode_expectation_location(result)
      )
      message <- krarkode_expectation_message(result)
      if (!is.null(message)) {
        payload[["message"]] <- message
      }
      krarkode_emit(payload)
    },
    end_test = function(context, test) {
      if (!self$should_emit(test)) {
        return()
      }
      krarkode_emit(list(type = "end_test", test = test))
    },
    end_file = function() {
      krarkode_emit(list(type = "end_file"))
    },
    should_emit = function(test) {
      is.null(self$selected_test) || identical(test, self$selected_test)
    }
  )
)

krarkode_run_tests <- function(path, selected_test = NULL) {
  reporter <- KrarkodeReporter$new(selected_test = selected_test)
  if (dir.exists(path)) {
    testthat::test_dir(path, reporter = reporter)
  } else {
    testthat::test_file(path, reporter = reporter)
  }
}
